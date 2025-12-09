const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse, paginate } = require('../utils/helpers');
const { logActivity } = require('./team-activity');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, leadId, contactId } = req.query;
    const { limit: queryLimit, offset } = paginate(page, limit);
    const orgId = req.organizationId;

    let whereClause = 'WHERE cl.organization_id = $1';
    let params = [orgId];
    let paramIndex = 2;

    if (leadId) {
      whereClause += ` AND cl.lead_id = $${paramIndex}`;
      params.push(leadId);
      paramIndex++;
    }
    if (contactId) {
      whereClause += ` AND cl.contact_id = $${paramIndex}`;
      params.push(contactId);
      paramIndex++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM call_logs cl ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT cl.*, 
        u.first_name as user_first_name, u.last_name as user_last_name,
        l.title as lead_title, l.contact_name as lead_contact_name,
        c.first_name as contact_first_name, c.last_name as contact_last_name
       FROM call_logs cl
       LEFT JOIN users u ON cl.user_id = u.id
       LEFT JOIN leads l ON cl.lead_id = l.id
       LEFT JOIN contacts c ON cl.contact_id = c.id
       ${whereClause}
       ORDER BY cl.called_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, queryLimit, offset]
    );

    res.json(formatResponse({
      callLogs: result.rows.map(row => ({
        id: row.id,
        phoneNumber: row.phone_number,
        callType: row.call_type,
        durationSeconds: row.duration_seconds,
        outcome: row.outcome,
        notes: row.notes,
        calledAt: row.called_at,
        leadId: row.lead_id,
        leadTitle: row.lead_title,
        leadContactName: row.lead_contact_name,
        contactId: row.contact_id,
        contactName: row.contact_first_name ? `${row.contact_first_name} ${row.contact_last_name || ''}`.trim() : null,
        userName: row.user_first_name ? `${row.user_first_name} ${row.user_last_name || ''}`.trim() : null,
        createdAt: row.created_at
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: queryLimit,
        totalPages: Math.ceil(total / queryLimit)
      }
    }));
  } catch (error) {
    console.error('Get call logs error:', error);
    res.status(500).json({ message: 'Failed to get call logs' });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const userId = req.userId;

    const result = await pool.query(
      `SELECT cl.*, 
        l.title as lead_title, l.contact_name as lead_contact_name,
        c.first_name as contact_first_name, c.last_name as contact_last_name
       FROM call_logs cl
       LEFT JOIN leads l ON cl.lead_id = l.id
       LEFT JOIN contacts c ON cl.contact_id = c.id
       WHERE cl.organization_id = $1 AND cl.user_id = $2
       ORDER BY cl.called_at DESC
       LIMIT 10`,
      [orgId, userId]
    );

    res.json(formatResponse({
      callLogs: result.rows.map(row => ({
        id: row.id,
        phoneNumber: row.phone_number,
        callType: row.call_type,
        durationSeconds: row.duration_seconds,
        outcome: row.outcome,
        notes: row.notes,
        calledAt: row.called_at,
        leadId: row.lead_id,
        leadTitle: row.lead_title,
        leadContactName: row.lead_contact_name,
        contactId: row.contact_id,
        contactName: row.contact_first_name ? `${row.contact_first_name} ${row.contact_last_name || ''}`.trim() : null
      }))
    }));
  } catch (error) {
    console.error('Get recent call logs error:', error);
    res.status(500).json({ message: 'Failed to get recent call logs' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const totalResult = await pool.query(
      'SELECT COUNT(*) FROM call_logs WHERE organization_id = $1',
      [orgId]
    );

    const todayResult = await pool.query(
      `SELECT COUNT(*) FROM call_logs 
       WHERE organization_id = $1 
       AND called_at >= CURRENT_DATE`,
      [orgId]
    );

    const thisWeekResult = await pool.query(
      `SELECT COUNT(*) FROM call_logs 
       WHERE organization_id = $1 
       AND called_at >= DATE_TRUNC('week', CURRENT_DATE)`,
      [orgId]
    );

    const avgDurationResult = await pool.query(
      `SELECT AVG(duration_seconds) as avg_duration FROM call_logs 
       WHERE organization_id = $1 AND duration_seconds > 0`,
      [orgId]
    );

    const outcomeStats = await pool.query(
      `SELECT outcome, COUNT(*) as count FROM call_logs 
       WHERE organization_id = $1 AND outcome IS NOT NULL
       GROUP BY outcome`,
      [orgId]
    );

    res.json(formatResponse({
      totalCalls: parseInt(totalResult.rows[0].count),
      callsToday: parseInt(todayResult.rows[0].count),
      callsThisWeek: parseInt(thisWeekResult.rows[0].count),
      avgDuration: Math.round(parseFloat(avgDurationResult.rows[0].avg_duration) || 0),
      outcomeBreakdown: outcomeStats.rows.reduce((acc, row) => {
        acc[row.outcome] = parseInt(row.count);
        return acc;
      }, {})
    }));
  } catch (error) {
    console.error('Get call stats error:', error);
    res.status(500).json({ message: 'Failed to get call stats' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { 
      leadId, contactId, phoneNumber, callType, 
      durationSeconds, outcome, notes, calledAt 
    } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    if (!phoneNumber) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    if (!leadId && !contactId) {
      return res.status(400).json({ message: 'Either leadId or contactId is required' });
    }

    if (leadId) {
      const leadCheck = await pool.query(
        'SELECT id FROM leads WHERE id = $1 AND organization_id = $2',
        [leadId, orgId]
      );
      if (leadCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Lead not found or access denied' });
      }
    }

    if (contactId) {
      const contactCheck = await pool.query(
        'SELECT id FROM contacts WHERE id = $1 AND organization_id = $2',
        [contactId, orgId]
      );
      if (contactCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Contact not found or access denied' });
      }
    }

    const result = await pool.query(
      `INSERT INTO call_logs (
        organization_id, user_id, lead_id, contact_id, phone_number,
        call_type, duration_seconds, outcome, notes, called_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        orgId, userId, leadId || null, contactId || null, phoneNumber,
        callType || 'outbound', durationSeconds || 0, outcome || null,
        notes || null, calledAt || new Date()
      ]
    );

    if (leadId) {
      const durationStr = durationSeconds ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s` : 'unknown duration';
      const outcomeStr = outcome ? ` - ${outcome}` : '';
      await pool.query(
        'INSERT INTO lead_activities (lead_id, user_id, type, description) VALUES ($1, $2, $3, $4)',
        [leadId, userId, 'call', `Made a phone call (${durationStr})${outcomeStr}`]
      );
    }

    const row = result.rows[0];
    const entityName = phoneNumber;
    const durationStr = durationSeconds ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s` : '';
    const description = `Made a call to ${phoneNumber}${durationStr ? ` (${durationStr})` : ''}`;
    logActivity(orgId, userId, 'call', 'call_log', row.id, entityName, description);

    res.status(201).json(formatResponse({
      callLog: {
        id: row.id,
        phoneNumber: row.phone_number,
        callType: row.call_type,
        durationSeconds: row.duration_seconds,
        outcome: row.outcome,
        notes: row.notes,
        calledAt: row.called_at,
        leadId: row.lead_id,
        contactId: row.contact_id,
        createdAt: row.created_at
      }
    }, 'Call logged successfully'));
  } catch (error) {
    console.error('Create call log error:', error);
    res.status(500).json({ message: 'Failed to log call' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { durationSeconds, outcome, notes } = req.body;
    const orgId = req.organizationId;

    const existing = await pool.query(
      'SELECT * FROM call_logs WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Call log not found' });
    }

    const result = await pool.query(
      `UPDATE call_logs SET
        duration_seconds = COALESCE($1, duration_seconds),
        outcome = COALESCE($2, outcome),
        notes = COALESCE($3, notes),
        updated_at = NOW()
      WHERE id = $4 AND organization_id = $5
      RETURNING *`,
      [durationSeconds, outcome, notes, id, orgId]
    );

    const row = result.rows[0];
    res.json(formatResponse({
      callLog: {
        id: row.id,
        phoneNumber: row.phone_number,
        callType: row.call_type,
        durationSeconds: row.duration_seconds,
        outcome: row.outcome,
        notes: row.notes,
        calledAt: row.called_at,
        leadId: row.lead_id,
        contactId: row.contact_id,
        createdAt: row.created_at
      }
    }, 'Call log updated successfully'));
  } catch (error) {
    console.error('Update call log error:', error);
    res.status(500).json({ message: 'Failed to update call log' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      'DELETE FROM call_logs WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Call log not found' });
    }

    res.json(formatResponse(null, 'Call log deleted successfully'));
  } catch (error) {
    console.error('Delete call log error:', error);
    res.status(500).json({ message: 'Failed to delete call log' });
  }
});

module.exports = router;
