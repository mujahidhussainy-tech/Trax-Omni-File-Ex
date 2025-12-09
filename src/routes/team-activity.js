const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { limit = 50, offset = 0, userId, actionType, entityType } = req.query;

    let query = `
      SELECT ta.*, u.first_name, u.last_name, u.email, u.avatar_url
      FROM team_activities ta
      LEFT JOIN users u ON ta.user_id = u.id
      WHERE ta.organization_id = $1
    `;
    const params = [orgId];
    let paramIndex = 2;

    if (userId) {
      query += ` AND ta.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (actionType) {
      query += ` AND ta.action_type = $${paramIndex}`;
      params.push(actionType);
      paramIndex++;
    }

    if (entityType) {
      query += ` AND ta.entity_type = $${paramIndex}`;
      params.push(entityType);
      paramIndex++;
    }

    query += ` ORDER BY ta.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    const activities = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      userName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email?.split('@')[0] || 'Unknown',
      userAvatar: row.avatar_url,
      userEmail: row.email,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entityName: row.entity_name,
      description: row.description,
      metadata: row.metadata,
      createdAt: row.created_at
    }));

    res.json(formatResponse({ activities }));
  } catch (error) {
    console.error('Get team activities error:', error);
    res.status(500).json({ message: 'Failed to fetch team activities' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { period = 'today' } = req.query;

    let dateFilter;
    if (period === 'today') {
      dateFilter = "created_at >= CURRENT_DATE";
    } else if (period === 'week') {
      dateFilter = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === 'month') {
      dateFilter = "created_at >= CURRENT_DATE - INTERVAL '30 days'";
    } else {
      dateFilter = "1=1";
    }

    const activityCountQuery = `
      SELECT 
        u.id as user_id,
        u.first_name,
        u.last_name,
        u.email,
        u.avatar_url,
        COUNT(ta.id) as activity_count,
        COUNT(CASE WHEN ta.action_type = 'create' THEN 1 END) as creates,
        COUNT(CASE WHEN ta.action_type = 'update' THEN 1 END) as updates,
        COUNT(CASE WHEN ta.action_type = 'call' THEN 1 END) as calls,
        COUNT(CASE WHEN ta.action_type = 'view' THEN 1 END) as views
      FROM organization_members om
      LEFT JOIN users u ON om.user_id = u.id
      LEFT JOIN team_activities ta ON ta.user_id = u.id 
        AND ta.organization_id = $1 
        AND ${dateFilter}
      WHERE om.organization_id = $1 AND om.status = 'active'
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.avatar_url
      ORDER BY activity_count DESC
    `;

    const statsResult = await pool.query(activityCountQuery, [orgId]);

    const totalQuery = `
      SELECT 
        COUNT(*) as total_activities,
        COUNT(CASE WHEN action_type = 'create' THEN 1 END) as total_creates,
        COUNT(CASE WHEN action_type = 'update' THEN 1 END) as total_updates,
        COUNT(CASE WHEN action_type = 'call' THEN 1 END) as total_calls,
        COUNT(CASE WHEN action_type = 'view' THEN 1 END) as total_views
      FROM team_activities
      WHERE organization_id = $1 AND ${dateFilter}
    `;

    const totalsResult = await pool.query(totalQuery, [orgId]);

    const memberStats = statsResult.rows.map(row => ({
      userId: row.user_id,
      userName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email?.split('@')[0] || 'Unknown',
      userAvatar: row.avatar_url,
      userEmail: row.email,
      activityCount: parseInt(row.activity_count) || 0,
      creates: parseInt(row.creates) || 0,
      updates: parseInt(row.updates) || 0,
      calls: parseInt(row.calls) || 0,
      views: parseInt(row.views) || 0
    }));

    const totals = totalsResult.rows[0];

    res.json(formatResponse({
      period,
      memberStats,
      totals: {
        totalActivities: parseInt(totals.total_activities) || 0,
        totalCreates: parseInt(totals.total_creates) || 0,
        totalUpdates: parseInt(totals.total_updates) || 0,
        totalCalls: parseInt(totals.total_calls) || 0,
        totalViews: parseInt(totals.total_views) || 0
      }
    }));
  } catch (error) {
    console.error('Get activity stats error:', error);
    res.status(500).json({ message: 'Failed to fetch activity stats' });
  }
});

router.post('/log', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const userId = req.userId;
    const { actionType, entityType, entityId, entityName, description, metadata } = req.body;

    if (!actionType || !entityType) {
      return res.status(400).json({ message: 'actionType and entityType are required' });
    }

    const result = await pool.query(
      `INSERT INTO team_activities 
        (organization_id, user_id, action_type, entity_type, entity_id, entity_name, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [orgId, userId, actionType, entityType, entityId, entityName, description, metadata ? JSON.stringify(metadata) : null]
    );

    res.status(201).json(formatResponse({ activity: result.rows[0] }, 'Activity logged successfully'));
  } catch (error) {
    console.error('Log activity error:', error);
    res.status(500).json({ message: 'Failed to log activity' });
  }
});

const logActivity = async (orgId, userId, actionType, entityType, entityId, entityName, description, metadata) => {
  try {
    await pool.query(
      `INSERT INTO team_activities 
        (organization_id, user_id, action_type, entity_type, entity_id, entity_name, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orgId, userId, actionType, entityType, entityId, entityName, description, metadata ? JSON.stringify(metadata) : null]
    );
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};

module.exports = router;
module.exports.logActivity = logActivity;
