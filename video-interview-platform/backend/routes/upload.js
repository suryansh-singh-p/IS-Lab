const express = require('express');
const path = require('path');
const db = require('../db');
const { uploadVideo } = require('../middleware/upload');
const { triggerPipeline } = require('../services/videoEvaluationPipeline');

const router = express.Router();

router.post('/', uploadVideo.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No video file provided'
            });
        }

        const { sessionId: sessionIdParam, session_id: sessionIdSnake, questionId, questionText } = req.body;
        const sessionIdFromBody = sessionIdParam || sessionIdSnake;
        const relativePath = path.join('uploads', req.file.filename).split(path.sep).join('/');

        let sessionId = sessionIdFromBody || null;
        let sessionVideoId = null;
        if (db.pool) {
            if (!sessionId) {
                sessionId = await db.createSession(null, req.user.id);
            }
            if (sessionId) {
                sessionVideoId = await db.insertSessionVideo(
                    sessionId,
                    questionId,
                    questionText,
                    req.file.filename,
                    relativePath,
                    req.file.size
                );
            }
        }

        if (sessionVideoId && req.file.path) {
            triggerPipeline(sessionVideoId, req.file.path, questionText || '', sessionId, questionId, req.file.filename);
        }

        console.log(`✓ Video uploaded successfully`);
        console.log(`  - Filename: ${req.file.filename}`);
        console.log(`  - Size: ${(req.file.size / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`  - Question ID: ${questionId || 'N/A'}`);
        if (sessionId) console.log(`  - Session ID: ${sessionId}`);

        res.status(200).json({
            success: true,
            message: 'Video uploaded successfully',
            data: {
                filename: req.file.filename,
                size: req.file.size,
                path: req.file.path,
                questionId: questionId || null,
                uploadedAt: new Date().toISOString(),
                ...(sessionId && { sessionId })
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Error uploading video',
            error: error.message
        });
    }
});

module.exports = router;
