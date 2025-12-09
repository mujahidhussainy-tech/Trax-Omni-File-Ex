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

    let whereClause = 'WHERE vn.organization_id = $1';
    let params = [orgId];
    let paramIndex = 2;

    if (leadId) {
      whereClause += ` AND vn.lead_id = $${paramIndex}`;
      params.push(leadId);
      paramIndex++;
    }
    if (contactId) {
      whereClause += ` AND vn.contact_id = $${paramIndex}`;
      params.push(contactId);
      paramIndex++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM voice_notes vn ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT vn.*, 
        u.first_name as user_first_name, u.last_name as user_last_name,
        l.title as lead_title,
        c.first_name as contact_first_name, c.last_name as contact_last_name
       FROM voice_notes vn
       LEFT JOIN users u ON vn.user_id = u.id
       LEFT JOIN leads l ON vn.lead_id = l.id
       LEFT JOIN contacts c ON vn.contact_id = c.id
       ${whereClause}
       ORDER BY vn.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, queryLimit, offset]
    );

    res.json(formatResponse({
      voiceNotes: result.rows.map(row => ({
        id: row.id,
        title: row.title,
        audioData: row.audio_data,
        durationSeconds: row.duration_seconds,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        transcription: row.transcription,
        leadId: row.lead_id,
        leadTitle: row.lead_title,
        contactId: row.contact_id,
        contactName: row.contact_first_name ? `${row.contact_first_name} ${row.contact_last_name || ''}`.trim() : null,
        userName: row.user_first_name ? `${row.user_first_name} ${row.user_last_name || ''}`.trim() : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        total,
        page: parseInt(page),
        limit: queryLimit,
        totalPages: Math.ceil(total / queryLimit)
      }
    }));
  } catch (error) {
    console.error('Get voice notes error:', error);
    res.status(500).json({ message: 'Failed to get voice notes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT vn.*, 
        u.first_name as user_first_name, u.last_name as user_last_name,
        l.title as lead_title,
        c.first_name as contact_first_name, c.last_name as contact_last_name
       FROM voice_notes vn
       LEFT JOIN users u ON vn.user_id = u.id
       LEFT JOIN leads l ON vn.lead_id = l.id
       LEFT JOIN contacts c ON vn.contact_id = c.id
       WHERE vn.id = $1 AND vn.organization_id = $2`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Voice note not found' });
    }

    const row = result.rows[0];
    res.json(formatResponse({
      voiceNote: {
        id: row.id,
        title: row.title,
        audioData: row.audio_data,
        durationSeconds: row.duration_seconds,
        fileSize: row.file_size,
        mimeType: row.mime_type,
        transcription: row.transcription,
        leadId: row.lead_id,
        leadTitle: row.lead_title,
        contactId: row.contact_id,
        contactName: row.contact_first_name ? `${row.contact_first_name} ${row.contact_last_name || ''}`.trim() : null,
        userName: row.user_first_name ? `${row.user_first_name} ${row.user_last_name || ''}`.trim() : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    }));
  } catch (error) {
    console.error('Get voice note error:', error);
    res.status(500).json({ message: 'Failed to get voice note' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { 
      title, audioData, durationSeconds, fileSize, mimeType,
      leadId, contactId, transcription
    } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    if (!audioData) {
      return res.status(400).json({ message: 'Audio data is required' });
    }

    if (!leadId && !contactId) {
      return res.status(400).json({ message: 'Either leadId or contactId is required' });
    }

    const result = await pool.query(
      `INSERT INTO voice_notes (
        organization_id, user_id, lead_id, contact_id,
        title, audio_data, duration_seconds, file_size, mime_type, transcription
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        orgId, userId, leadId || null, contactId || null,
        title || 'Voice Note', audioData, durationSeconds || 0, 
        fileSize || 0, mimeType || 'audio/m4a', transcription || null
      ]
    );

    const entityType = leadId ? 'lead' : 'contact';
    const entityId = leadId || contactId;
    logActivity(orgId, userId, 'create', 'voice_note', result.rows[0].id, title || 'Voice Note', 
      `Recorded voice note for ${entityType}`);

    res.status(201).json(formatResponse({ 
      voiceNote: {
        id: result.rows[0].id,
        title: result.rows[0].title,
        durationSeconds: result.rows[0].duration_seconds,
        fileSize: result.rows[0].file_size,
        mimeType: result.rows[0].mime_type,
        leadId: result.rows[0].lead_id,
        contactId: result.rows[0].contact_id,
        createdAt: result.rows[0].created_at
      }
    }, 'Voice note saved successfully'));
  } catch (error) {
    console.error('Create voice note error:', error);
    res.status(500).json({ message: 'Failed to save voice note' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, transcription } = req.body;
    const orgId = req.organizationId;

    const existing = await pool.query(
      'SELECT * FROM voice_notes WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ message: 'Voice note not found' });
    }

    const result = await pool.query(
      `UPDATE voice_notes SET
        title = COALESCE($1, title),
        transcription = COALESCE($2, transcription),
        updated_at = NOW()
      WHERE id = $3 AND organization_id = $4
      RETURNING *`,
      [title, transcription, id, orgId]
    );

    res.json(formatResponse({ 
      voiceNote: {
        id: result.rows[0].id,
        title: result.rows[0].title,
        durationSeconds: result.rows[0].duration_seconds,
        transcription: result.rows[0].transcription,
        updatedAt: result.rows[0].updated_at
      }
    }, 'Voice note updated successfully'));
  } catch (error) {
    console.error('Update voice note error:', error);
    res.status(500).json({ message: 'Failed to update voice note' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      'DELETE FROM voice_notes WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Voice note not found' });
    }

    logActivity(orgId, req.userId, 'delete', 'voice_note', id, 
      result.rows[0].title || 'Voice Note', 'Deleted voice note');

    res.json(formatResponse(null, 'Voice note deleted successfully'));
  } catch (error) {
    console.error('Delete voice note error:', error);
    res.status(500).json({ message: 'Failed to delete voice note' });
  }
});

module.exports = router;
