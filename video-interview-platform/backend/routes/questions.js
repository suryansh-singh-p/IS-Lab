const express = require('express');
const pdfParse = require('pdf-parse');
const config = require('../config');
const openai = require('../services/llm');
const { uploadPdf } = require('../middleware/upload');

const router = express.Router();

router.post('/', uploadPdf.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No PDF file provided'
            });
        }

        console.log(`✓ Resume PDF received`);
        console.log(`  - Size: ${(req.file.size / 1024).toFixed(2)} KB`);

        const pdfData = await pdfParse(req.file.buffer);
        const cvText = pdfData.text;

        console.log(`  - Extracted ${cvText.length} characters from PDF`);

        const prompt = `CV TEXT:\n${cvText}\n\nSEED QUESTIONS:\n${JSON.stringify(config.SEED_QUESTIONS)}\n\n` +
            `Based on this CV/resume, generate 10 personalized interview questions that are tailored to the candidate's experience, skills, and background. ` +
            `The questions should be inspired by the seed questions but customized based on specific details from the CV. ` +
            `Output ONLY valid JSON in this exact format: {"questions": [{"id": 1, "text": "question text here"}, {"id": 2, "text": "question text here"}, ...]}`;

        const response = await openai.chat.completions.create({
            model: config.llmModel,
            messages: [
                { role: 'system', content: 'You are a recruitment assistant. Output ONLY valid JSON with no additional text or markdown.' },
                { role: 'user', content: prompt }
            ]
        });

        const generatedContent = response.choices[0].message.content;
        console.log('[Questions] Raw LLM response:', generatedContent);
        console.log('✓ Generated personalized questions');

        let questions;
        try {
            questions = JSON.parse(generatedContent);
        } catch (parseError) {
            console.error('Failed to parse LLM response:', generatedContent);
            throw new Error('Failed to parse generated questions');
        }

        res.status(200).json({
            success: true,
            message: 'Questions generated successfully',
            data: questions
        });
    } catch (error) {
        console.error('Question generation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating questions',
            error: error.message
        });
    }
});

module.exports = router;
