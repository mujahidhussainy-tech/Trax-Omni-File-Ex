const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

const availableIntegrations = [
  {
    type: 'facebook_leads',
    name: 'Facebook Lead Ads',
    description: 'Automatically import leads from Facebook Lead Ads',
    icon: 'facebook',
    configFields: ['page_id', 'access_token', 'auto_import']
  },
  {
    type: 'instagram_leads',
    name: 'Instagram Lead Ads',
    description: 'Capture leads from Instagram ad campaigns',
    icon: 'instagram',
    configFields: ['ig_id', 'access_token', 'auto_import']
  },
  {
    type: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Send messages and notifications via WhatsApp',
    icon: 'whatsapp',
    configFields: ['phone_number_id', 'access_token']
  },
  {
    type: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync meetings and appointments',
    icon: 'calendar',
    configFields: ['calendar_id']
  },
  {
    type: 'email',
    name: 'Email Integration',
    description: 'Send automated emails to leads',
    icon: 'mail',
    configFields: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_password']
  },
  {
    type: 'sms',
    name: 'SMS Integration',
    description: 'Send SMS notifications to leads',
    icon: 'message',
    configFields: ['provider', 'api_key']
  }
];

router.get('/available', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const activeResult = await pool.query(
      'SELECT type, is_active FROM integrations WHERE organization_id = $1',
      [orgId]
    );

    const activeMap = {};
    activeResult.rows.forEach(row => {
      activeMap[row.type] = row.is_active;
    });

    const integrations = availableIntegrations.map(int => ({
      ...int,
      isActive: activeMap[int.type] || false,
      isConfigured: activeMap.hasOwnProperty(int.type)
    }));

    res.json(formatResponse({ integrations }));
  } catch (error) {
    console.error('Get available integrations error:', error);
    res.status(500).json({ message: 'Failed to get integrations' });
  }
});

router.get('/', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      'SELECT * FROM integrations WHERE organization_id = $1',
      [orgId]
    );

    res.json(formatResponse({
      integrations: result.rows.map(row => ({
        id: row.id,
        type: row.type,
        name: row.name,
        config: typeof row.config === 'string' ? JSON.parse(row.config) : row.config,
        isActive: row.is_active,
        createdAt: row.created_at
      }))
    }));
  } catch (error) {
    console.error('Get integrations error:', error);
    res.status(500).json({ message: 'Failed to get integrations' });
  }
});

router.post('/', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { type, config } = req.body;

    if (!type) {
      return res.status(400).json({ message: 'Integration type is required' });
    }

    const integrationInfo = availableIntegrations.find(i => i.type === type);
    if (!integrationInfo) {
      return res.status(400).json({ message: 'Invalid integration type' });
    }

    const existing = await pool.query(
      'SELECT * FROM integrations WHERE organization_id = $1 AND type = $2',
      [orgId, type]
    );

    let result;
    if (existing.rows.length > 0) {
      const existingConfig = typeof existing.rows[0].config === 'string' 
        ? JSON.parse(existing.rows[0].config) 
        : existing.rows[0].config || {};
      
      const mergedConfig = { ...existingConfig, ...(config || {}) };
      
      result = await pool.query(
        `UPDATE integrations SET config = $1, is_active = true, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [JSON.stringify(mergedConfig), existing.rows[0].id]
      );
    } else {
      result = await pool.query(
        `INSERT INTO integrations (organization_id, type, name, config, is_active) 
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [orgId, type, integrationInfo.name, JSON.stringify(config || {})]
      );
    }

    const returnConfig = typeof result.rows[0].config === 'string' 
      ? JSON.parse(result.rows[0].config) 
      : result.rows[0].config;

    res.status(201).json(formatResponse({
      integration: {
        id: result.rows[0].id,
        type: result.rows[0].type,
        name: result.rows[0].name,
        config: returnConfig,
        isActive: result.rows[0].is_active
      }
    }, 'Integration added successfully'));
  } catch (error) {
    console.error('Add integration error:', error);
    res.status(500).json({ message: 'Failed to add integration' });
  }
});

router.put('/:id/toggle', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE integrations SET is_active = NOT is_active 
       WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Integration not found' });
    }

    res.json(formatResponse({
      integration: result.rows[0]
    }, `Integration ${result.rows[0].is_active ? 'activated' : 'deactivated'}`));
  } catch (error) {
    console.error('Toggle integration error:', error);
    res.status(500).json({ message: 'Failed to toggle integration' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM integrations WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Integration not found' });
    }

    res.json(formatResponse(null, 'Integration removed successfully'));
  } catch (error) {
    console.error('Remove integration error:', error);
    res.status(500).json({ message: 'Failed to remove integration' });
  }
});

module.exports = router;
