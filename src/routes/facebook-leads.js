const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || 'trax_omni_verify_token_2024';

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Facebook webhook verified');
      return res.status(200).send(challenge);
    }
  }
  res.sendStatus(403);
});

router.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'page') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            await processLeadgenEvent(change.value);
          }
        }
      }
    }

    if (body.object === 'instagram') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'leadgen') {
            await processInstagramLeadEvent(change.value);
          }
        }
      }
    }

    res.status(200).send('EVENT_RECEIVED');
  } catch (error) {
    console.error('Facebook webhook error:', error);
    res.status(200).send('EVENT_RECEIVED');
  }
});

async function processLeadgenEvent(leadData) {
  try {
    const { leadgen_id, page_id, form_id, created_time } = leadData;

    const integration = await pool.query(
      `SELECT i.*, o.id as org_id FROM integrations i
       JOIN organizations o ON i.organization_id = o.id
       WHERE i.type = 'facebook_leads' AND i.is_active = true
       AND i.config->>'page_id' = $1`,
      [page_id]
    );

    if (integration.rows.length === 0) {
      console.log('No active Facebook integration found for page:', page_id);
      return;
    }

    const org = integration.rows[0];
    const config = typeof org.config === 'string' ? JSON.parse(org.config) : org.config;

    let leadDetails = null;
    if (config.access_token) {
      leadDetails = await fetchFacebookLead(leadgen_id, config.access_token);
    }

    await pool.query(
      `INSERT INTO social_leads (
        organization_id, platform, platform_lead_id, page_id, form_id,
        lead_data, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (platform, platform_lead_id) DO UPDATE SET
        lead_data = $6, updated_at = NOW()`,
      [
        org.org_id,
        'facebook',
        leadgen_id,
        page_id,
        form_id,
        JSON.stringify(leadDetails || leadData),
        'pending'
      ]
    );

    if (leadDetails && config.auto_import) {
      await convertToLead(org.org_id, leadDetails, 'Facebook Lead Ads', leadgen_id, 'facebook');
    }

    console.log('Facebook lead processed:', leadgen_id);
  } catch (error) {
    console.error('Error processing Facebook lead:', error);
  }
}

async function processInstagramLeadEvent(leadData) {
  try {
    const { leadgen_id, ig_id, form_id, created_time } = leadData;

    const integration = await pool.query(
      `SELECT i.*, o.id as org_id FROM integrations i
       JOIN organizations o ON i.organization_id = o.id
       WHERE i.type = 'instagram_leads' AND i.is_active = true
       AND i.config->>'ig_id' = $1`,
      [ig_id]
    );

    if (integration.rows.length === 0) {
      console.log('No active Instagram integration found for account:', ig_id);
      return;
    }

    const org = integration.rows[0];
    const config = typeof org.config === 'string' ? JSON.parse(org.config) : org.config;

    let leadDetails = null;
    if (config.access_token) {
      leadDetails = await fetchInstagramLead(leadgen_id, config.access_token);
    }

    await pool.query(
      `INSERT INTO social_leads (
        organization_id, platform, platform_lead_id, page_id, form_id,
        lead_data, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (platform, platform_lead_id) DO UPDATE SET
        lead_data = $6, updated_at = NOW()`,
      [
        org.org_id,
        'instagram',
        leadgen_id,
        ig_id,
        form_id,
        JSON.stringify(leadDetails || leadData),
        'pending'
      ]
    );

    if (leadDetails && config.auto_import) {
      await convertToLead(org.org_id, leadDetails, 'Instagram Lead Ads', leadgen_id, 'instagram');
    }

    console.log('Instagram lead processed:', leadgen_id);
  } catch (error) {
    console.error('Error processing Instagram lead:', error);
  }
}

async function fetchFacebookLead(leadId, accessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${leadId}?access_token=${accessToken}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch Facebook lead');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching Facebook lead:', error);
    return null;
  }
}

async function fetchInstagramLead(leadId, accessToken) {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${leadId}?access_token=${accessToken}`
    );
    if (!response.ok) {
      throw new Error('Failed to fetch Instagram lead');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching Instagram lead:', error);
    return null;
  }
}

async function convertToLead(organizationId, leadDetails, source, platformLeadId, platform) {
  try {
    const fieldData = leadDetails.field_data || [];
    const fieldMap = {};
    fieldData.forEach(field => {
      fieldMap[field.name.toLowerCase()] = field.values?.[0] || '';
    });

    const contactName = fieldMap.full_name || 
      `${fieldMap.first_name || ''} ${fieldMap.last_name || ''}`.trim() ||
      'Facebook Lead';
    const contactEmail = fieldMap.email || '';
    const contactPhone = fieldMap.phone_number || fieldMap.phone || '';
    const company = fieldMap.company_name || fieldMap.company || '';

    const stageResult = await pool.query(
      `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position LIMIT 1`,
      [organizationId]
    );
    const stageId = stageResult.rows[0]?.id || null;

    const newLead = await pool.query(
      `INSERT INTO leads (
        organization_id, title, contact_name, contact_email, contact_phone,
        company, source, stage_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING id`,
      [
        organizationId,
        `Lead from ${source}`,
        contactName,
        contactEmail,
        contactPhone,
        company,
        source,
        stageId,
        'new'
      ]
    );

    if (platformLeadId && newLead.rows[0]) {
      await pool.query(
        `UPDATE social_leads SET status = 'converted', converted_lead_id = $1, updated_at = NOW()
         WHERE platform = $2 AND platform_lead_id = $3`,
        [newLead.rows[0].id, platform, platformLeadId]
      );
    }

    console.log('Lead created from social media:', contactName);
    return newLead.rows[0]?.id;
  } catch (error) {
    console.error('Error converting social lead:', error);
    return null;
  }
}

router.use(authenticate);

router.get('/leads', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { platform, status, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let query = `
      SELECT * FROM social_leads
      WHERE organization_id = $1
    `;
    const params = [orgId];
    let paramIndex = 2;

    if (platform) {
      query += ` AND platform = $${paramIndex}`;
      params.push(platform);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), offset);

    const result = await pool.query(query, params);

    const countQuery = `
      SELECT COUNT(*) FROM social_leads
      WHERE organization_id = $1
      ${platform ? ` AND platform = $2` : ''}
      ${status ? ` AND status = $${platform ? 3 : 2}` : ''}
    `;
    const countParams = [orgId];
    if (platform) countParams.push(platform);
    if (status) countParams.push(status);
    const countResult = await pool.query(countQuery, countParams);

    res.json(formatResponse({
      leads: result.rows.map(row => ({
        id: row.id,
        platform: row.platform,
        platformLeadId: row.platform_lead_id,
        pageId: row.page_id,
        formId: row.form_id,
        leadData: typeof row.lead_data === 'string' ? JSON.parse(row.lead_data) : row.lead_data,
        status: row.status,
        convertedLeadId: row.converted_lead_id,
        createdAt: row.created_at
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    }));
  } catch (error) {
    console.error('Get social leads error:', error);
    res.status(500).json({ message: 'Failed to get social leads' });
  }
});

router.post('/leads/:id/convert', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;
    const { title, stageId } = req.body;

    const socialLead = await pool.query(
      `SELECT * FROM social_leads WHERE id = $1 AND organization_id = $2`,
      [id, orgId]
    );

    if (socialLead.rows.length === 0) {
      return res.status(404).json({ message: 'Social lead not found' });
    }

    const lead = socialLead.rows[0];
    const leadData = typeof lead.lead_data === 'string' ? JSON.parse(lead.lead_data) : lead.lead_data;

    const fieldData = leadData.field_data || [];
    const fieldMap = {};
    fieldData.forEach(field => {
      fieldMap[field.name.toLowerCase()] = field.values?.[0] || '';
    });

    const contactName = fieldMap.full_name || 
      `${fieldMap.first_name || ''} ${fieldMap.last_name || ''}`.trim() ||
      'Social Lead';
    const contactEmail = fieldMap.email || '';
    const contactPhone = fieldMap.phone_number || fieldMap.phone || '';
    const company = fieldMap.company_name || fieldMap.company || '';

    let finalStageId = stageId;
    if (!finalStageId) {
      const stageResult = await pool.query(
        `SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position LIMIT 1`,
        [orgId]
      );
      finalStageId = stageResult.rows[0]?.id || null;
    }

    const source = lead.platform === 'facebook' ? 'Facebook Lead Ads' : 'Instagram Lead Ads';

    const newLead = await pool.query(
      `INSERT INTO leads (
        organization_id, title, contact_name, contact_email, contact_phone,
        company, source, stage_id, status, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING *`,
      [
        orgId,
        title || `Lead from ${source}`,
        contactName,
        contactEmail,
        contactPhone,
        company,
        source,
        finalStageId,
        'new',
        req.userId
      ]
    );

    await pool.query(
      `UPDATE social_leads SET status = 'converted', converted_lead_id = $1, updated_at = NOW()
       WHERE id = $2`,
      [newLead.rows[0].id, id]
    );

    res.json(formatResponse({
      lead: newLead.rows[0],
      message: 'Lead converted successfully'
    }));
  } catch (error) {
    console.error('Convert social lead error:', error);
    res.status(500).json({ message: 'Failed to convert lead' });
  }
});

router.delete('/leads/:id', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM social_leads WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Social lead not found' });
    }

    res.json(formatResponse(null, 'Social lead deleted'));
  } catch (error) {
    console.error('Delete social lead error:', error);
    res.status(500).json({ message: 'Failed to delete social lead' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const stats = await pool.query(`
      SELECT 
        platform,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'converted') as converted,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as last_7_days,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as last_30_days
      FROM social_leads
      WHERE organization_id = $1
      GROUP BY platform
    `, [orgId]);

    const totalStats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'converted') as converted
      FROM social_leads
      WHERE organization_id = $1
    `, [orgId]);

    res.json(formatResponse({
      byPlatform: stats.rows.map(row => ({
        platform: row.platform,
        total: parseInt(row.total),
        pending: parseInt(row.pending),
        converted: parseInt(row.converted),
        last7Days: parseInt(row.last_7_days),
        last30Days: parseInt(row.last_30_days)
      })),
      totals: {
        total: parseInt(totalStats.rows[0]?.total || 0),
        pending: parseInt(totalStats.rows[0]?.pending || 0),
        converted: parseInt(totalStats.rows[0]?.converted || 0)
      }
    }));
  } catch (error) {
    console.error('Get social lead stats error:', error);
    res.status(500).json({ message: 'Failed to get stats' });
  }
});

router.post('/test-connection', async (req, res) => {
  try {
    const { platform, accessToken, pageId } = req.body;

    if (platform === 'facebook') {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}?fields=name,id&access_token=${accessToken}`
      );
      const data = await response.json();

      if (data.error) {
        return res.status(400).json({ 
          message: data.error.message || 'Invalid Facebook credentials' 
        });
      }

      res.json(formatResponse({
        success: true,
        pageName: data.name,
        pageId: data.id
      }, 'Connection successful'));
    } else if (platform === 'instagram') {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}?fields=name,username,id&access_token=${accessToken}`
      );
      const data = await response.json();

      if (data.error) {
        return res.status(400).json({ 
          message: data.error.message || 'Invalid Instagram credentials' 
        });
      }

      res.json(formatResponse({
        success: true,
        accountName: data.name || data.username,
        accountId: data.id
      }, 'Connection successful'));
    } else {
      res.status(400).json({ message: 'Invalid platform' });
    }
  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({ message: 'Connection test failed' });
  }
});

router.get('/forms', async (req, res) => {
  try {
    const { pageId, accessToken } = req.query;

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/leadgen_forms?access_token=${accessToken}`
    );
    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ message: data.error.message });
    }

    res.json(formatResponse({
      forms: (data.data || []).map(form => ({
        id: form.id,
        name: form.name,
        status: form.status
      }))
    }));
  } catch (error) {
    console.error('Get forms error:', error);
    res.status(500).json({ message: 'Failed to get forms' });
  }
});

module.exports = router;
