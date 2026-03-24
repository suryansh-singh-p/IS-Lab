const openai = require('./llm');
const config = require('../config');

/**
 * Evaluate a candidate's answer using the interview question and transcript.
 * Returns structured JSON including completeness and relevance.
 * @param {string} questionText
 * @param {string} transcriptText
 * @param {object|null} qaJson
 * @returns {Promise<{ answer_text: string, evaluation: object, score: number, expected_expression: string, expected_emotions: object }>} 
 */
async function evaluateAnswer(questionText, transcriptText, qaJson = null) {
    const systemPrompt = `You are an interview evaluator. Output ONLY valid JSON with no markdown or extra text.`;
    const qaBlock = qaJson ? `\n\nHere is the QA JSON from transcription:\n${JSON.stringify(qaJson)}` : '';
    const userPrompt = `Interview question: "${questionText}"

Candidate's spoken answer (transcript): "${transcriptText}"${qaBlock}

Provide:
1. expected_expression: What a strong answer to this question would typically include (key points, themes, or ideal expression in 2-4 sentences).
2. answer_text: A clear, concise summary of the candidate's answer in 1-3 sentences.
3. evaluation: An object with these keys: completeness, relevance, clarity, structure, examples, overall (each 1-3 sentences).
4. expected_emotions: {"should_show": [..], "red_flags": [..]} (empty arrays allowed).
5. score: A number from 1 to 10 (integer) for how well they answered.

Output ONLY this JSON (no code block, no explanation):
{"expected_expression":"...","answer_text":"...","evaluation":{"completeness":"...","relevance":"...","clarity":"...","structure":"...","examples":"...","overall":"..."},"expected_emotions":{"should_show":["confidence"],"red_flags":[]},"score":7}`;

    console.log('[Evaluation] Calling LLM...');
    const response = await openai.chat.completions.create({
        model: config.llmModel,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    });

    const raw = response.choices[0].message.content;
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, '').trim();
    
    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e1) {
        // Try to extract JSON object from the response
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (e2) {
                // Try fixing common LLM JSON issues: trailing commas, unescaped newlines
                let fixed = jsonMatch[0]
                    .replace(/,\s*([}\]])/g, '$1')           // trailing commas
                    .replace(/[\r\n]+/g, ' ')                 // newlines inside strings
                    .replace(/\t/g, ' ');                     // tabs
                try {
                    parsed = JSON.parse(fixed);
                } catch (e3) {
                    console.error('[Evaluation] Raw LLM output:', raw.slice(0, 600));
                    throw new Error('LLM returned invalid JSON: ' + e3.message);
                }
            }
        } else {
            console.error('[Evaluation] Raw LLM output:', raw.slice(0, 600));
            throw new Error('LLM response contains no JSON object');
        }
    }

    const expected_expression = typeof parsed.expected_expression === 'string' ? parsed.expected_expression : String(parsed.expected_expression || '');
    const answer_text = typeof parsed.answer_text === 'string' ? parsed.answer_text : String(parsed.answer_text || '');
    const evaluation = (parsed && typeof parsed.evaluation === 'object' && parsed.evaluation !== null)
        ? parsed.evaluation
        : { overall: String(parsed.evaluation || '') };
    const expected_emotions = (parsed && typeof parsed.expected_emotions === 'object' && parsed.expected_emotions !== null)
        ? parsed.expected_emotions
        : { should_show: [], red_flags: [] };
    let score = Number(parsed.score);
    if (Number.isNaN(score) || score < 1) score = 1;
    if (score > 10) score = 10;

    console.log('[Evaluation] Done — score:', score);
    return {
        answer_text,
        evaluation,
        score,
        expected_expression,
        expected_emotions,
        evaluation_json: { expected_expression, answer_text, evaluation, expected_emotions, score }
    };
}

/**
 * Evaluate emotions detected from DeepFace against expected emotions for the question.
 * Returns an emotion score from 1-10 based on how well the candidate's emotions match expectations.
 * @param {object} emotionData - DeepFace emotion analysis result
 * @param {object} expectedEmotions - Expected emotions from answer evaluation { should_show: [], red_flags: [] }
 * @param {string} questionText - The interview question for context
 * @returns {Promise<{ emotion_score: number, emotion_evaluation: object }>}
 */
async function evaluateEmotions(emotionData, expectedEmotions, questionText) {
    if (!emotionData || !emotionData.summary) {
        console.log('[EmotionEval] No emotion data available, returning neutral score');
        return {
            emotion_score: 5,
            emotion_evaluation: {
                summary: 'No emotion data available for evaluation',
                positive_signals: [],
                negative_signals: [],
                recommendation: 'Unable to evaluate emotions - video analysis unavailable'
            }
        };
    }

    const systemPrompt = `You are an interview emotion evaluator. Output ONLY valid JSON with no markdown or extra text.`;
    
    const emotionSummary = emotionData.summary;
    const userPrompt = `Interview question: "${questionText}"

Candidate's detected emotions during the video:
- Dominant overall emotion: ${emotionSummary.dominant_emotion_overall}
- Longest shown emotion: ${emotionSummary.longest_emotion?.emotion} (${emotionSummary.longest_emotion?.duration_sec}s)
- Emotion distribution: ${JSON.stringify(emotionSummary.emotion_distribution_percent)}
- Average emotion scores: ${JSON.stringify(emotionSummary.average_scores)}

Expected emotions for a good answer:
- Should show: ${JSON.stringify(expectedEmotions?.should_show || ['confidence', 'engagement'])}
- Red flags to avoid: ${JSON.stringify(expectedEmotions?.red_flags || ['nervous', 'disengaged'])}

Evaluate the candidate's emotional presentation during this interview answer. Consider:
1. Does their emotional expression match what's expected for this type of question?
2. Are there concerning patterns (too much nervousness, anger, etc.)?
3. Do they show appropriate confidence and engagement?

Output ONLY this JSON (no code block, no explanation):
{"emotion_score":7,"emotion_evaluation":{"summary":"Brief overall assessment","positive_signals":["signal1","signal2"],"negative_signals":["signal1"],"confidence_level":"high/medium/low","engagement_level":"high/medium/low","recommendation":"Brief suggestion for improvement"}}`;

    console.log('[EmotionEval] Calling LLM...');
    const response = await openai.chat.completions.create({
        model: config.llmModel,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ]
    });

    const raw = response.choices[0].message.content;
    const cleaned = raw.replace(/^```\w*\n?|\n?```$/g, '').trim();

    let parsed;
    try {
        parsed = JSON.parse(cleaned);
    } catch (e1) {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsed = JSON.parse(jsonMatch[0]);
            } catch (e2) {
                let fixed = jsonMatch[0]
                    .replace(/,\s*([}\]])/g, '$1')
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/\t/g, ' ');
                try {
                    parsed = JSON.parse(fixed);
                } catch (e3) {
                    console.error('[EmotionEval] Raw LLM output:', raw.slice(0, 600));
                    // Return default score on parse failure
                    return {
                        emotion_score: 5,
                        emotion_evaluation: {
                            summary: 'Failed to parse emotion evaluation',
                            positive_signals: [],
                            negative_signals: [],
                            recommendation: 'Unable to evaluate emotions'
                        }
                    };
                }
            }
        } else {
            return {
                emotion_score: 5,
                emotion_evaluation: {
                    summary: 'No valid response from evaluator',
                    positive_signals: [],
                    negative_signals: [],
                    recommendation: 'Unable to evaluate emotions'
                }
            };
        }
    }

    let emotion_score = Number(parsed.emotion_score);
    if (Number.isNaN(emotion_score) || emotion_score < 1) emotion_score = 1;
    if (emotion_score > 10) emotion_score = 10;

    const emotion_evaluation = parsed.emotion_evaluation || {
        summary: 'Evaluation completed',
        positive_signals: [],
        negative_signals: [],
        recommendation: ''
    };

    console.log('[EmotionEval] Done — emotion score:', emotion_score);
    return { emotion_score, emotion_evaluation };
}

/**
 * Compute overall score from answer and emotion scores.
 * Default weighting: 70% answer, 30% emotions.
 * @param {number} answerScore - Score from answer evaluation (1-10)
 * @param {number} emotionScore - Score from emotion evaluation (1-10)
 * @param {object} options - Optional weighting { answerWeight: 0.7, emotionWeight: 0.3 }
 * @returns {{ overall_score: number, breakdown: object }}
 */
function computeOverallScore(answerScore, emotionScore, options = {}) {
    const answerWeight = options.answerWeight ?? 0.7;
    const emotionWeight = options.emotionWeight ?? 0.3;

    const weightedAnswer = answerScore * answerWeight;
    const weightedEmotion = emotionScore * emotionWeight;
    const overall = Math.round((weightedAnswer + weightedEmotion) * 10) / 10;

    return {
        overall_score: Math.min(10, Math.max(1, overall)),
        breakdown: {
            answer_score: answerScore,
            answer_weight: answerWeight,
            emotion_score: emotionScore,
            emotion_weight: emotionWeight,
            weighted_answer: Math.round(weightedAnswer * 10) / 10,
            weighted_emotion: Math.round(weightedEmotion * 10) / 10
        }
    };
}

module.exports = { evaluateAnswer, evaluateEmotions, computeOverallScore };
