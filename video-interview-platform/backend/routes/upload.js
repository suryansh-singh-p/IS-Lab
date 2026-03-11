const express = require('express');
const path = require('path');
const db = require('../db');
const config = require('../config');
const { uploadVideo } = require('../middleware/upload');
const { triggerPipeline } = require('../services/videoEvaluationPipeline');

const router = express.Router();

// Legacy local-file upload path (kept behind config flag for compatibility).
if (true || config.useLocalVideoStorage) {
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
                triggerPipeline(
                    sessionVideoId,
                    req.file.path,
                    questionText || '',
                    sessionId,
                    questionId,
                    req.file.filename
                );
            }

            console.log(`✓ Video uploaded successfully (local storage)`);
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
            console.error('Upload error (local storage):', error);
            res.status(500).json({
                success: false,
                message: 'Error uploading video',
                error: error.message
            });
        }
    });
} else {
    // Cloud mode: expects JSON body with a Cloudinary video URL and metadata.
    router.post('/', async (req, res) => {
        try {
            const {
                videoUrl,
                publicId,
                duration,
                questionId,
                questionText,
                sessionId: sessionIdParam,
                session_id: sessionIdSnake
            } = req.body || {};

            if (!videoUrl || typeof videoUrl !== 'string') {
                return res.status(400).json({
                    success: false,
                    message: 'videoUrl is required'
                });
            }

            let sessionId = sessionIdParam || sessionIdSnake || null;
            let sessionVideoId = null;

            if (db.pool) {
                if (!sessionId) {
                    sessionId = await db.createSession(null, req.user.id);
                }
                if (sessionId) {
                    const filename = publicId || videoUrl.split('/').pop() || null;
                    const filePath = videoUrl; // reuse existing column to store Cloudinary URL
                    const fileSizeBytes = null;

                    sessionVideoId = await db.insertSessionVideo(
                        sessionId,
                        questionId,
                        questionText,
                        filename,
                        filePath,
                        fileSizeBytes
                    );
                }
            }

            console.log(`✓ Video metadata received (Cloudinary)`);
            console.log(`  - URL: ${videoUrl}`);
            if (publicId) console.log(`  - Public ID: ${publicId}`);
            if (typeof duration === 'number') console.log(`  - Duration: ${duration}s`);
            console.log(`  - Question ID: ${questionId || 'N/A'}`);
            if (sessionId) console.log(`  - Session ID: ${sessionId}`);
            if (sessionVideoId) console.log(`  - Session Video ID: ${sessionVideoId}`);

            // NOTE: In the new architecture, AI evaluation should be handled by
            // the external Hugging Face microservice using the Cloudinary URL.
            // This backend only records metadata and returns success.

            res.status(200).json({
                success: true,
                message: 'Video metadata saved successfully',
                data: {
                    videoUrl,
                    publicId: publicId || null,
                    duration: duration ?? null,
                    questionId: questionId || null,
                    uploadedAt: new Date().toISOString(),
                    ...(sessionId && { sessionId }),
                    ...(sessionVideoId && { sessionVideoId })
                }
            });
        } catch (error) {
            console.error('Upload error (Cloud mode):', error);
            res.status(500).json({
                success: false,
                message: 'Error saving video metadata',
                error: error.message
            });
        }
    });
}

module.exports = router;
