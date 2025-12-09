require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./models/schema');

const authRoutes = require('./routes/auth');
const leadsRoutes = require('./routes/leads');
const contactsRoutes = require('./routes/contacts');
const organizationsRoutes = require('./routes/organizations');
const pipelineRoutes = require('./routes/pipeline');
const subscriptionsRoutes = require('./routes/subscriptions');
const integrationsRoutes = require('./routes/integrations');
const industriesRoutes = require('./routes/industries');
const dashboardRoutes = require('./routes/dashboard');
const remindersRoutes = require('./routes/reminders');
const callLogsRoutes = require('./routes/call-logs');
const teamActivityRoutes = require('./routes/team-activity');
const voiceNotesRoutes = require('./routes/voice-notes');
const analyticsRoutes = require('./routes/analytics');
const facebookLeadsRoutes = require('./routes/facebook-leads');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Organization-Id']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/industries', industriesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/call-logs', callLogsRoutes);
app.use('/api/team-activity', teamActivityRoutes);
app.use('/api/voice-notes', voiceNotesRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/facebook-leads', facebookLeadsRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

app.use('*', (req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

const startServer = async () => {
  try {
    await initializeDatabase();
    console.log('Database initialized');
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Trax Omni API server running on port ${PORT}`);
      console.log(`Health check: http://0.0.0.0:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
