const express = require('express');
const corsMiddleware = require('./middleware/cors');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const uploadRoutes = require('./routes/upload');
const questionsRoutes = require('./routes/questions');
const adminRoutes = require('./routes/admin');
const { serveVideo } = require('./routes/admin');
const { requireAuth, requireAuthOrQueryToken, requireRole } = require('./middleware/auth');

const app = express();

app.use(corsMiddleware);
app.use(express.json());

app.use('/health', healthRoutes);
app.use('/auth', authRoutes);
app.use('/sessions', requireAuth, requireRole('user'), sessionsRoutes);
app.use('/upload', requireAuth, requireRole('user'), uploadRoutes);
app.use('/generate-questions', requireAuth, requireRole('user'), questionsRoutes);
app.get('/admin/video/:id', requireAuthOrQueryToken, requireRole('admin'), serveVideo);
app.use('/admin', requireAuth, requireRole('admin'), adminRoutes);

app.use(errorHandler);

module.exports = app;
