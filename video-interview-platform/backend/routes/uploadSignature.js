const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');

const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const { questionId, sessionId: sessionIdParam, session_id: sessionIdSnake } = req.body || {};

        if (!config.cloudinaryCloudName || !config.cloudinaryApiKey || !config.cloudinaryApiSecret) {
            return res.status(500).json({
                success: false,
                message: 'Cloudinary is not configured on the server'
            });
        }

        let sessionId = sessionIdParam || sessionIdSnake || null;

        // Ensure a session exists (one per interview) when signature is first requested.
        if (!sessionId && db.pool) {
            sessionId = await db.createSession(null, req.user.id);
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const folder = config.cloudinaryUploadFolder || undefined;
        const publicId =
            sessionId && questionId != null
                ? `${sessionId}/question-${questionId}`
                : undefined;

        const paramsToSign = {
            ...(folder && { folder }),
            ...(publicId && { public_id: publicId }),
            ...(config.cloudinaryUploadPreset && { upload_preset: config.cloudinaryUploadPreset }),
            timestamp
        };

        const stringToSign = Object.keys(paramsToSign)
            .sort()
            .map((key) => `${key}=${paramsToSign[key]}`)
            .join('&');

        const signature = crypto
            .createHash('sha1')
            .update(stringToSign + config.cloudinaryApiSecret)
            .digest('hex');

        return res.json({
            success: true,
            data: {
                cloudName: config.cloudinaryCloudName,
                apiKey: config.cloudinaryApiKey,
                timestamp,
                signature,
                folder: folder || null,
                publicId: publicId || null,
                uploadPreset: config.cloudinaryUploadPreset || null,
                ...(sessionId && { sessionId })
            }
        });
    } catch (error) {
        console.error('Upload signature error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate upload signature',
            error: error.message
        });
    }
});

module.exports = router;

