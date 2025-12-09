const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse, paginate } = require('../utils/helpers');
const { logActivity } = require('./team-activity');
const { calculateLeadScore, calculateAllLeadScores, getScoreCategory, getScoreColor } = require('../services/leadScoring');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, stage_id, assigned_to, sort_by, score_category } = req.query;
    const { limit: queryLimit, offset } = paginate(page, limit);
    const orgId = req.organizationId;

    let whereClause = 'WHERE l.organization_id = $1';
    let params = [orgId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (l.title ILIKE $${paramIndex} OR l.contact_name ILIKE $${paramIndex} OR l.contact_email ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (status) {
      whereClause += ` AND l.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    if (stage_id) {
      whereClause += ` AND l.stage_id = $${paramIndex}`;
      params.push(stage_id);
      paramIndex++;
    }
    if (assigned_to) {
      whereClause += ` AND l.assigned_to = $${paramIndex}`;
      params.push(assigned_to);
      paramIndex++;
    }
    if (score_category) {
      if (score_category === 'hot') {
        whereClause += ` AND l.lead_score >= 70`;
      } else if (score_category === 'warm') {
        whereClause += ` AND l.lead_score >= 40 AND l.lead_score < 70`;
      } else if (score_category === 'cold') {
        whereClause += ` AND l.lead_score < 40`;
      }
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM leads l ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    let orderBy = 'l.created_at DESC';
    if (sort_by === 'score') {
      orderBy = 'l.lead_score DESC, l.created_at DESC';
    } else if (sort_by === 'value') {
      orderBy = 'l.value DESC, l.created_at DESC';
    }

    const result = await pool.query(
      `SELECT l.*, 
        ps.name as stage_name, ps.color as stage_color,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.stage_id = ps.id
       LEFT JOIN users u ON l.assigned_to = u.id
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, queryLimit, offset]
    );

    res.json(formatResponse({
      leads: result.rows.map(row => {
        const score = row.lead_score || 0;
        return {
          id: row.id,
          title: row.title,
          value: parseFloat(row.value) || 0,
          status: row.status,
          source: row.source,
          priority: row.priority,
          stageId: row.stage_id,
          stage: row.stage_name ? row.stage_name.toLowerCase() : 'new',
          stageName: row.stage_name,
          stageColor: row.stage_color,
          contactName: row.contact_name,
          contactEmail: row.contact_email,
          contactPhone: row.contact_phone,
          company: row.company,
          notes: row.notes,
          expectedCloseDate: row.expected_close_date,
          assignedTo: row.assigned_to,
          assignedName: row.assigned_first_name ? `${row.assigned_first_name} ${row.assigned_last_name || ''}`.trim() : null,
          leadScore: score,
          scoreCategory: getScoreCategory(score),
          scoreColor: getScoreColor(score),
          lastActivityAt: row.last_activity_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      }),
      pagination: {
        total,
        page: parseInt(page),
        limit: queryLimit,
        totalPages: Math.ceil(total / queryLimit)
      }
    }));
  } catch (error) {
    console.error('Get leads error:', error);
    res.status(500).json({ message: 'Failed to get leads' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM leads WHERE organization_id = $1',
      [orgId]
    );

    const valueResult = await pool.query(
      'SELECT COALESCE(SUM(value), 0) as total_value FROM leads WHERE organization_id = $1',
      [orgId]
    );

    const wonResult = await pool.query(
      `SELECT COUNT(*) as count, COALESCE(SUM(value), 0) as value 
       FROM leads l 
       JOIN pipeline_stages ps ON l.stage_id = ps.id 
       WHERE l.organization_id = $1 AND ps.name = 'Won'`,
      [orgId]
    );

    const thisMonthResult = await pool.query(
      `SELECT COUNT(*) FROM leads 
       WHERE organization_id = $1 
       AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [orgId]
    );

    res.json(formatResponse({
      totalLeads: parseInt(totalResult.rows[0].count),
      totalValue: parseFloat(valueResult.rows[0].total_value),
      wonDeals: parseInt(wonResult.rows[0].count),
      wonValue: parseFloat(wonResult.rows[0].value),
      leadsThisMonth: parseInt(thisMonthResult.rows[0].count)
    }));
  } catch (error) {
    console.error('Get lead stats error:', error);
    res.status(500).json({ message: 'Failed to get lead stats' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT l.*, 
        ps.name as stage_name, ps.color as stage_color,
        u.first_name as assigned_first_name, u.last_name as assigned_last_name, u.email as assigned_email
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.stage_id = ps.id
       LEFT JOIN users u ON l.assigned_to = u.id
       WHERE l.id = $1 AND l.organization_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const row = result.rows[0];
    const score = row.lead_score || 0;

    const activitiesResult = await pool.query(
      `SELECT la.*, u.first_name, u.last_name 
       FROM lead_activities la
       LEFT JOIN users u ON la.user_id = u.id
       WHERE la.lead_id = $1
       ORDER BY la.created_at DESC
       LIMIT 20`,
      [id]
    );

    res.json(formatResponse({
      lead: {
        id: row.id,
        title: row.title,
        value: parseFloat(row.value) || 0,
        status: row.status,
        source: row.source,
        priority: row.priority,
        stageId: row.stage_id,
        stageName: row.stage_name,
        stageColor: row.stage_color,
        contactName: row.contact_name,
        contactEmail: row.contact_email,
        contactPhone: row.contact_phone,
        company: row.company,
        notes: row.notes,
        expectedCloseDate: row.expected_close_date,
        assignedTo: row.assigned_to,
        assignedName: row.assigned_first_name ? `${row.assigned_first_name} ${row.assigned_last_name || ''}`.trim() : null,
        assignedEmail: row.assigned_email,
        leadScore: score,
        scoreCategory: getScoreCategory(score),
        scoreColor: getScoreColor(score),
        lastActivityAt: row.last_activity_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      },
      activities: activitiesResult.rows.map(a => ({
        id: a.id,
        type: a.type,
        description: a.description,
        userName: a.first_name ? `${a.first_name} ${a.last_name || ''}`.trim() : 'Unknown',
        createdAt: a.created_at
      }))
    }));
  } catch (error) {
    console.error('Get lead error:', error);
    res.status(500).json({ message: 'Failed to get lead' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { 
      title, value, stageId, status, source, priority,
      contactName, contactEmail, contactPhone, company,
      notes, expectedCloseDate, assignedTo 
    } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    console.log('Lead create request - orgId:', orgId, 'userId:', userId, 'body:', JSON.stringify(req.body));

    if (!orgId) {
      console.error('Lead creation failed: No organization ID in request');
      return res.status(400).json({ message: 'Organization not found. Please log out and log back in.' });
    }

    if (!userId) {
      console.error('Lead creation failed: No user ID in request');
      return res.status(400).json({ message: 'User authentication error. Please log in again.' });
    }

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    let finalStageId = stageId;
    if (!finalStageId) {
      const defaultStage = await pool.query(
        'SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1',
        [orgId]
      );
      console.log('Default stage query result:', defaultStage.rows);
      if (defaultStage.rows.length > 0) {
        finalStageId = defaultStage.rows[0].id;
      } else {
        console.error('No pipeline stages found for organization:', orgId);
        return res.status(400).json({ message: 'No pipeline stages found. Please contact support.' });
      }
    }

    const result = await pool.query(
      `INSERT INTO leads (
        organization_id, title, value, stage_id, status, source, priority,
        contact_name, contact_email, contact_phone, company,
        notes, expected_close_date, assigned_to, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        orgId, title, value || 0, finalStageId, status || 'new', source || 'manual', priority || 'medium',
        contactName || '', contactEmail || '', contactPhone || '', company || '',
        notes || '', expectedCloseDate || null, assignedTo || userId, userId
      ]
    );

    await pool.query(
      'INSERT INTO lead_activities (lead_id, user_id, type, description) VALUES ($1, $2, $3, $4)',
      [result.rows[0].id, userId, 'created', 'Lead was created']
    );

    logActivity(orgId, userId, 'create', 'lead', result.rows[0].id, title, `Created lead "${title}"`);

    const leadScore = await calculateLeadScore(result.rows[0].id, orgId);

    res.status(201).json(formatResponse({ 
      lead: {
        ...result.rows[0],
        leadScore: leadScore || 0,
        scoreCategory: getScoreCategory(leadScore || 0),
        scoreColor: getScoreColor(leadScore || 0)
      }
    }, 'Lead created successfully'));
  } catch (error) {
    console.error('Create lead error:', error.message, error.stack);
    res.status(500).json({ message: 'Failed to create lead: ' + error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      title, value, stageId, stage, status, source, priority,
      contactName, contactEmail, contactPhone, company,
      notes, expectedCloseDate, assignedTo 
    } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    const existing = await pool.query(
      'SELECT * FROM leads WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    let finalStageId = stageId;
    if (!finalStageId && stage) {
      const stageResult = await pool.query(
        'SELECT id FROM pipeline_stages WHERE organization_id = $1 AND LOWER(name) = LOWER($2)',
        [orgId, stage]
      );
      if (stageResult.rows.length > 0) {
        finalStageId = stageResult.rows[0].id;
      }
    }

    const result = await pool.query(
      `UPDATE leads SET
        title = COALESCE($1, title),
        value = COALESCE($2, value),
        stage_id = COALESCE($3, stage_id),
        status = COALESCE($4, status),
        source = COALESCE($5, source),
        priority = COALESCE($6, priority),
        contact_name = COALESCE($7, contact_name),
        contact_email = COALESCE($8, contact_email),
        contact_phone = COALESCE($9, contact_phone),
        company = COALESCE($10, company),
        notes = COALESCE($11, notes),
        expected_close_date = COALESCE($12, expected_close_date),
        assigned_to = COALESCE($13, assigned_to),
        updated_at = NOW()
      WHERE id = $14 AND organization_id = $15
      RETURNING *`,
      [
        title, value, finalStageId, status, source, priority,
        contactName, contactEmail, contactPhone, company,
        notes, expectedCloseDate, assignedTo,
        id, orgId
      ]
    );

    await pool.query(
      'INSERT INTO lead_activities (lead_id, user_id, type, description) VALUES ($1, $2, $3, $4)',
      [id, userId, 'updated', 'Lead was updated']
    );

    logActivity(orgId, userId, 'update', 'lead', id, result.rows[0].title, `Updated lead "${result.rows[0].title}"`);

    const leadScore = await calculateLeadScore(id, orgId);

    res.json(formatResponse({ 
      lead: {
        ...result.rows[0],
        leadScore: leadScore || 0,
        scoreCategory: getScoreCategory(leadScore || 0),
        scoreColor: getScoreColor(leadScore || 0)
      }
    }, 'Lead updated successfully'));
  } catch (error) {
    console.error('Update lead error:', error);
    res.status(500).json({ message: 'Failed to update lead' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    logActivity(orgId, req.userId, 'delete', 'lead', id, result.rows[0].title, `Deleted lead "${result.rows[0].title}"`);

    res.json(formatResponse(null, 'Lead deleted successfully'));
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ message: 'Failed to delete lead' });
  }
});

router.post('/:id/recalculate-score', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const leadResult = await pool.query(
      'SELECT id FROM leads WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ message: 'Lead not found' });
    }

    const score = await calculateLeadScore(id, orgId);

    res.json(formatResponse({
      leadId: id,
      score: score || 0,
      scoreCategory: getScoreCategory(score || 0),
      scoreColor: getScoreColor(score || 0)
    }, 'Lead score recalculated successfully'));
  } catch (error) {
    console.error('Recalculate lead score error:', error);
    res.status(500).json({ message: 'Failed to recalculate lead score' });
  }
});

router.post('/recalculate-all-scores', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const scores = await calculateAllLeadScores(orgId);

    const hotCount = scores.filter(s => s.score >= 70).length;
    const warmCount = scores.filter(s => s.score >= 40 && s.score < 70).length;
    const coldCount = scores.filter(s => s.score < 40).length;

    res.json(formatResponse({
      totalUpdated: scores.length,
      summary: {
        hot: hotCount,
        warm: warmCount,
        cold: coldCount
      }
    }, 'All lead scores recalculated successfully'));
  } catch (error) {
    console.error('Recalculate all lead scores error:', error);
    res.status(500).json({ message: 'Failed to recalculate lead scores' });
  }
});

router.get('/score-summary', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT 
        COUNT(*) FILTER (WHERE lead_score >= 70) as hot_leads,
        COUNT(*) FILTER (WHERE lead_score >= 40 AND lead_score < 70) as warm_leads,
        COUNT(*) FILTER (WHERE lead_score < 40) as cold_leads,
        AVG(lead_score) as average_score,
        COUNT(*) as total_leads
       FROM leads WHERE organization_id = $1`,
      [orgId]
    );

    const row = result.rows[0];

    res.json(formatResponse({
      hotLeads: parseInt(row.hot_leads) || 0,
      warmLeads: parseInt(row.warm_leads) || 0,
      coldLeads: parseInt(row.cold_leads) || 0,
      averageScore: Math.round(parseFloat(row.average_score) || 0),
      totalLeads: parseInt(row.total_leads) || 0
    }));
  } catch (error) {
    console.error('Get score summary error:', error);
    res.status(500).json({ message: 'Failed to get score summary' });
  }
});

module.exports = router;
