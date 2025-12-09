const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

router.get('/stats', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const leadsResult = await pool.query(
      'SELECT COUNT(*) as total FROM leads WHERE organization_id = $1',
      [orgId]
    );

    const contactsResult = await pool.query(
      'SELECT COUNT(*) as total FROM contacts WHERE organization_id = $1',
      [orgId]
    );

    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(value), 0) as total 
       FROM leads l 
       JOIN pipeline_stages ps ON l.stage_id = ps.id 
       WHERE l.organization_id = $1 AND ps.name = 'Won'`,
      [orgId]
    );

    const thisMonthLeads = await pool.query(
      `SELECT COUNT(*) as total FROM leads 
       WHERE organization_id = $1 
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [orgId]
    );

    const lastMonthLeads = await pool.query(
      `SELECT COUNT(*) as total FROM leads 
       WHERE organization_id = $1 
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
       AND created_at < DATE_TRUNC('month', CURRENT_DATE)`,
      [orgId]
    );

    const thisMonth = parseInt(thisMonthLeads.rows[0].total);
    const lastMonth = parseInt(lastMonthLeads.rows[0].total);
    const leadsGrowth = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : 100;

    res.json(formatResponse({
      totalLeads: parseInt(leadsResult.rows[0].total),
      totalContacts: parseInt(contactsResult.rows[0].total),
      totalRevenue: parseFloat(revenueResult.rows[0].total),
      leadsThisMonth: thisMonth,
      leadsGrowth: leadsGrowth
    }));
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to get dashboard stats' });
  }
});

router.get('/recent-leads', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT l.*, ps.name as stage_name, ps.color as stage_color
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.stage_id = ps.id
       WHERE l.organization_id = $1
       ORDER BY l.created_at DESC
       LIMIT 5`,
      [orgId]
    );

    res.json(formatResponse({
      leads: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        value: parseFloat(row.value) || 0,
        contactName: row.contact_name,
        stageName: row.stage_name,
        stageColor: row.stage_color,
        createdAt: row.created_at
      }))
    }));
  } catch (error) {
    console.error('Get recent leads error:', error);
    res.status(500).json({ message: 'Failed to get recent leads' });
  }
});

router.get('/pipeline-summary', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT ps.name, ps.color, COUNT(l.id) as count, COALESCE(SUM(l.value), 0) as value
       FROM pipeline_stages ps
       LEFT JOIN leads l ON l.stage_id = ps.id
       WHERE ps.organization_id = $1
       GROUP BY ps.id, ps.name, ps.color, ps.position
       ORDER BY ps.position ASC`,
      [orgId]
    );

    res.json(formatResponse({
      pipeline: result.rows.map(row => ({
        name: row.name,
        color: row.color,
        count: parseInt(row.count),
        value: parseFloat(row.value)
      }))
    }));
  } catch (error) {
    console.error('Get pipeline summary error:', error);
    res.status(500).json({ message: 'Failed to get pipeline summary' });
  }
});

module.exports = router;
