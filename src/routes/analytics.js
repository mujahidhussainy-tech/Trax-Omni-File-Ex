const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

const sanitizePeriod = (period) => {
  const days = parseInt(period, 10);
  if (isNaN(days) || days < 1 || days > 365) {
    return 30;
  }
  return days;
};

router.get('/overview', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = '30' } = req.query;
    const days = sanitizePeriod(period);

    const totalLeads = await pool.query(
      'SELECT COUNT(*) as total FROM leads WHERE organization_id = $1',
      [orgId]
    );

    const periodLeads = await pool.query(
      `SELECT COUNT(*) as total FROM leads 
       WHERE organization_id = $1 
       AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const previousPeriodLeads = await pool.query(
      `SELECT COUNT(*) as total FROM leads 
       WHERE organization_id = $1 
       AND created_at >= NOW() - INTERVAL '1 day' * $2
       AND created_at < NOW() - INTERVAL '1 day' * $3`,
      [orgId, days * 2, days]
    );

    const wonLeads = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(l.value), 0) as revenue
       FROM leads l
       JOIN pipeline_stages ps ON l.stage_id = ps.id
       WHERE l.organization_id = $1 AND LOWER(ps.name) = 'won'
       AND l.updated_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const lostLeads = await pool.query(
      `SELECT COUNT(*) as total
       FROM leads l
       JOIN pipeline_stages ps ON l.stage_id = ps.id
       WHERE l.organization_id = $1 AND LOWER(ps.name) = 'lost'
       AND l.updated_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const totalContacts = await pool.query(
      'SELECT COUNT(*) as total FROM contacts WHERE organization_id = $1',
      [orgId]
    );

    const callsCount = await pool.query(
      `SELECT COUNT(*) as total FROM call_logs 
       WHERE organization_id = $1 
       AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const activitiesCount = await pool.query(
      `SELECT COUNT(*) as total FROM activities 
       WHERE organization_id = $1 
       AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const current = parseInt(periodLeads.rows[0].total);
    const previous = parseInt(previousPeriodLeads.rows[0].total);
    const growth = previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);
    
    const won = parseInt(wonLeads.rows[0].total);
    const lost = parseInt(lostLeads.rows[0].total);
    const conversionRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0;

    res.json(formatResponse({
      totalLeads: parseInt(totalLeads.rows[0].total),
      periodLeads: current,
      leadGrowth: growth,
      totalContacts: parseInt(totalContacts.rows[0].total),
      wonDeals: won,
      lostDeals: lost,
      revenue: parseFloat(wonLeads.rows[0].revenue),
      conversionRate,
      totalCalls: parseInt(callsCount.rows[0].total),
      totalActivities: parseInt(activitiesCount.rows[0].total),
      period: days,
    }));
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ message: 'Failed to get analytics overview' });
  }
});

router.get('/leads-trend', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = '30' } = req.query;
    const days = sanitizePeriod(period);

    const result = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM leads
       WHERE organization_id = $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [orgId, days]
    );

    const trendData = result.rows.map(row => ({
      date: row.date,
      count: parseInt(row.count),
    }));

    res.json(formatResponse({ trend: trendData }));
  } catch (error) {
    console.error('Leads trend error:', error);
    res.status(500).json({ message: 'Failed to get leads trend' });
  }
});

router.get('/revenue-trend', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = '30' } = req.query;
    const days = sanitizePeriod(period);

    const result = await pool.query(
      `SELECT DATE(l.updated_at) as date, SUM(l.value) as revenue, COUNT(*) as deals
       FROM leads l
       JOIN pipeline_stages ps ON l.stage_id = ps.id
       WHERE l.organization_id = $1
       AND LOWER(ps.name) = 'won'
       AND l.updated_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY DATE(l.updated_at)
       ORDER BY date ASC`,
      [orgId, days]
    );

    const trendData = result.rows.map(row => ({
      date: row.date,
      revenue: parseFloat(row.revenue) || 0,
      deals: parseInt(row.deals),
    }));

    res.json(formatResponse({ trend: trendData }));
  } catch (error) {
    console.error('Revenue trend error:', error);
    res.status(500).json({ message: 'Failed to get revenue trend' });
  }
});

router.get('/pipeline-breakdown', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT ps.name, ps.color, COUNT(l.id) as count, COALESCE(SUM(l.value), 0) as value
       FROM pipeline_stages ps
       LEFT JOIN leads l ON l.stage_id = ps.id AND l.organization_id = $1
       WHERE ps.organization_id = $1
       GROUP BY ps.id, ps.name, ps.color, ps.position
       ORDER BY ps.position ASC`,
      [orgId]
    );

    const total = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);
    
    const breakdown = result.rows.map(row => ({
      name: row.name,
      color: row.color,
      count: parseInt(row.count),
      value: parseFloat(row.value),
      percentage: total > 0 ? Math.round((parseInt(row.count) / total) * 100) : 0,
    }));

    res.json(formatResponse({ breakdown, total }));
  } catch (error) {
    console.error('Pipeline breakdown error:', error);
    res.status(500).json({ message: 'Failed to get pipeline breakdown' });
  }
});

router.get('/lead-sources', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT COALESCE(source, 'Unknown') as source, COUNT(*) as count, 
              COALESCE(SUM(value), 0) as value
       FROM leads
       WHERE organization_id = $1
       GROUP BY source
       ORDER BY count DESC
       LIMIT 10`,
      [orgId]
    );

    const total = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    const sources = result.rows.map(row => ({
      source: row.source,
      count: parseInt(row.count),
      value: parseFloat(row.value),
      percentage: total > 0 ? Math.round((parseInt(row.count) / total) * 100) : 0,
    }));

    res.json(formatResponse({ sources, total }));
  } catch (error) {
    console.error('Lead sources error:', error);
    res.status(500).json({ message: 'Failed to get lead sources' });
  }
});

router.get('/team-performance', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = '30' } = req.query;
    const days = sanitizePeriod(period);

    const result = await pool.query(
      `SELECT u.id, u.name, u.email,
              COUNT(DISTINCT l.id) as leads_count,
              COUNT(DISTINCT CASE WHEN LOWER(ps.name) = 'won' THEN l.id END) as won_count,
              COALESCE(SUM(CASE WHEN LOWER(ps.name) = 'won' THEN l.value ELSE 0 END), 0) as revenue,
              COUNT(DISTINCT cl.id) as calls_count,
              COUNT(DISTINCT a.id) as activities_count
       FROM organization_members om
       JOIN users u ON om.user_id = u.id
       LEFT JOIN leads l ON l.assigned_to = u.id AND l.organization_id = $1
                           AND l.created_at >= NOW() - INTERVAL '1 day' * $2
       LEFT JOIN pipeline_stages ps ON l.stage_id = ps.id
       LEFT JOIN call_logs cl ON cl.user_id = u.id AND cl.organization_id = $1
                                AND cl.created_at >= NOW() - INTERVAL '1 day' * $2
       LEFT JOIN activities a ON a.user_id = u.id AND a.organization_id = $1
                                AND a.created_at >= NOW() - INTERVAL '1 day' * $2
       WHERE om.organization_id = $1
       GROUP BY u.id, u.name, u.email
       ORDER BY revenue DESC`,
      [orgId, days]
    );

    const performance = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      leadsCount: parseInt(row.leads_count),
      wonCount: parseInt(row.won_count),
      revenue: parseFloat(row.revenue),
      callsCount: parseInt(row.calls_count),
      activitiesCount: parseInt(row.activities_count),
      conversionRate: parseInt(row.leads_count) > 0 
        ? Math.round((parseInt(row.won_count) / parseInt(row.leads_count)) * 100) 
        : 0,
    }));

    res.json(formatResponse({ performance }));
  } catch (error) {
    console.error('Team performance error:', error);
    res.status(500).json({ message: 'Failed to get team performance' });
  }
});

router.get('/activity-summary', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = '7' } = req.query;
    const days = sanitizePeriod(period);

    const result = await pool.query(
      `SELECT type, COUNT(*) as count
       FROM activities
       WHERE organization_id = $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY type
       ORDER BY count DESC`,
      [orgId, days]
    );

    const callStats = await pool.query(
      `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN outcome = 'answered' THEN 1 END) as answered,
         COUNT(CASE WHEN outcome = 'no_answer' THEN 1 END) as no_answer,
         ROUND(AVG(duration)) as avg_duration
       FROM call_logs
       WHERE organization_id = $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [orgId, days]
    );

    const activities = result.rows.map(row => ({
      type: row.type,
      count: parseInt(row.count),
    }));

    res.json(formatResponse({
      activities,
      callStats: {
        total: parseInt(callStats.rows[0].total),
        answered: parseInt(callStats.rows[0].answered),
        noAnswer: parseInt(callStats.rows[0].no_answer),
        avgDuration: parseInt(callStats.rows[0].avg_duration) || 0,
      },
    }));
  } catch (error) {
    console.error('Activity summary error:', error);
    res.status(500).json({ message: 'Failed to get activity summary' });
  }
});

router.get('/score-distribution', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT 
         COUNT(CASE WHEN lead_score >= 70 THEN 1 END) as hot,
         COUNT(CASE WHEN lead_score >= 40 AND lead_score < 70 THEN 1 END) as warm,
         COUNT(CASE WHEN lead_score < 40 OR lead_score IS NULL THEN 1 END) as cold,
         ROUND(AVG(lead_score)) as average
       FROM leads
       WHERE organization_id = $1`,
      [orgId]
    );

    res.json(formatResponse({
      distribution: {
        hot: parseInt(result.rows[0].hot),
        warm: parseInt(result.rows[0].warm),
        cold: parseInt(result.rows[0].cold),
        average: parseInt(result.rows[0].average) || 0,
      },
    }));
  } catch (error) {
    console.error('Score distribution error:', error);
    res.status(500).json({ message: 'Failed to get score distribution' });
  }
});

module.exports = router;
