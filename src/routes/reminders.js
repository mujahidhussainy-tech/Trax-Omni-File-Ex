const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const orgId = req.headers['x-organization-id'];
    const { upcoming, completed, leadId, contactId } = req.query;

    let query = `
      SELECT r.*, 
        l.title as lead_title, l.contact_name as lead_contact_name,
        c.first_name as contact_first_name, c.last_name as contact_last_name
      FROM reminders r
      LEFT JOIN leads l ON r.lead_id = l.id
      LEFT JOIN contacts c ON r.contact_id = c.id
      WHERE r.organization_id = $1 AND r.user_id = $2
    `;
    const params = [orgId, req.user.userId];

    if (upcoming === 'true') {
      query += ` AND r.is_completed = false AND r.reminder_date >= NOW()`;
    }
    if (completed === 'true') {
      query += ` AND r.is_completed = true`;
    }
    if (leadId) {
      query += ` AND r.lead_id = $${params.length + 1}`;
      params.push(leadId);
    }
    if (contactId) {
      query += ` AND r.contact_id = $${params.length + 1}`;
      params.push(contactId);
    }

    query += ` ORDER BY r.reminder_date ASC`;

    const result = await pool.query(query, params);
    res.json({ reminders: result.rows });
  } catch (error) {
    console.error('Error fetching reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const orgId = req.headers['x-organization-id'];
    const { title, description, reminderDate, reminderType, leadId, contactId } = req.body;

    if (!title || !reminderDate) {
      return res.status(400).json({ error: 'Title and reminder date are required' });
    }

    const result = await pool.query(
      `INSERT INTO reminders (organization_id, user_id, lead_id, contact_id, title, description, reminder_date, reminder_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [orgId, req.user.userId, leadId || null, contactId || null, title, description || null, reminderDate, reminderType || 'follow_up']
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating reminder:', error);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, reminderDate, reminderType, isCompleted } = req.body;

    let updateQuery = 'UPDATE reminders SET updated_at = NOW()';
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updateQuery += `, title = $${paramIndex++}`;
      params.push(title);
    }
    if (description !== undefined) {
      updateQuery += `, description = $${paramIndex++}`;
      params.push(description);
    }
    if (reminderDate !== undefined) {
      updateQuery += `, reminder_date = $${paramIndex++}`;
      params.push(reminderDate);
    }
    if (reminderType !== undefined) {
      updateQuery += `, reminder_type = $${paramIndex++}`;
      params.push(reminderType);
    }
    if (isCompleted !== undefined) {
      updateQuery += `, is_completed = $${paramIndex++}`;
      params.push(isCompleted);
      if (isCompleted) {
        updateQuery += `, completed_at = NOW()`;
      }
    }

    updateQuery += ` WHERE id = $${paramIndex++} AND user_id = $${paramIndex++} RETURNING *`;
    params.push(id, req.user.userId);

    const result = await pool.query(updateQuery, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating reminder:', error);
    res.status(500).json({ error: 'Failed to update reminder' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    res.json({ message: 'Reminder deleted successfully' });
  } catch (error) {
    console.error('Error deleting reminder:', error);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
});

router.get('/today', authenticate, async (req, res) => {
  try {
    const orgId = req.headers['x-organization-id'];

    const result = await pool.query(
      `SELECT r.*, 
        l.title as lead_title, l.contact_name as lead_contact_name,
        c.first_name as contact_first_name, c.last_name as contact_last_name
       FROM reminders r
       LEFT JOIN leads l ON r.lead_id = l.id
       LEFT JOIN contacts c ON r.contact_id = c.id
       WHERE r.organization_id = $1 
         AND r.user_id = $2 
         AND r.is_completed = false
         AND DATE(r.reminder_date) = CURRENT_DATE
       ORDER BY r.reminder_date ASC`,
      [orgId, req.user.userId]
    );

    res.json({ reminders: result.rows });
  } catch (error) {
    console.error('Error fetching today reminders:', error);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
});

module.exports = router;
