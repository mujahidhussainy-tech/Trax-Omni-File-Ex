const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

router.get('/stages', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      'SELECT * FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC',
      [orgId]
    );

    const stagesWithCounts = await Promise.all(
      result.rows.map(async (stage) => {
        const countResult = await pool.query(
          'SELECT COUNT(*) as count, COALESCE(SUM(value), 0) as total_value FROM leads WHERE stage_id = $1',
          [stage.id]
        );
        return {
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: stage.position,
          leadsCount: parseInt(countResult.rows[0].count),
          totalValue: parseFloat(countResult.rows[0].total_value)
        };
      })
    );

    res.json(formatResponse({ stages: stagesWithCounts }));
  } catch (error) {
    console.error('Get stages error:', error);
    res.status(500).json({ message: 'Failed to get pipeline stages' });
  }
});

router.post('/stages', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { name, color } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Stage name is required' });
    }

    const maxPosition = await pool.query(
      'SELECT COALESCE(MAX(position), 0) as max_pos FROM pipeline_stages WHERE organization_id = $1',
      [orgId]
    );
    const newPosition = maxPosition.rows[0].max_pos + 1;

    const result = await pool.query(
      'INSERT INTO pipeline_stages (organization_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING *',
      [orgId, name, color || '#7C3AED', newPosition]
    );

    res.status(201).json(formatResponse({
      stage: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        color: result.rows[0].color,
        position: result.rows[0].position
      }
    }, 'Stage created successfully'));
  } catch (error) {
    console.error('Create stage error:', error);
    res.status(500).json({ message: 'Failed to create stage' });
  }
});

router.put('/stages/:id', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;
    const { name, color, position } = req.body;

    const result = await pool.query(
      `UPDATE pipeline_stages SET
        name = COALESCE($1, name),
        color = COALESCE($2, color),
        position = COALESCE($3, position)
      WHERE id = $4 AND organization_id = $5
      RETURNING *`,
      [name, color, position, id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Stage not found' });
    }

    res.json(formatResponse({
      stage: {
        id: result.rows[0].id,
        name: result.rows[0].name,
        color: result.rows[0].color,
        position: result.rows[0].position
      }
    }, 'Stage updated successfully'));
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({ message: 'Failed to update stage' });
  }
});

router.delete('/stages/:id', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { id } = req.params;

    const leadsCount = await pool.query(
      'SELECT COUNT(*) FROM leads WHERE stage_id = $1',
      [id]
    );

    if (parseInt(leadsCount.rows[0].count) > 0) {
      return res.status(400).json({ message: 'Cannot delete stage with leads. Move leads first.' });
    }

    const result = await pool.query(
      'DELETE FROM pipeline_stages WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Stage not found' });
    }

    res.json(formatResponse(null, 'Stage deleted successfully'));
  } catch (error) {
    console.error('Delete stage error:', error);
    res.status(500).json({ message: 'Failed to delete stage' });
  }
});

router.put('/stages/reorder', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { stages } = req.body;

    if (!stages || !Array.isArray(stages)) {
      return res.status(400).json({ message: 'Stages array is required' });
    }

    for (const stage of stages) {
      await pool.query(
        'UPDATE pipeline_stages SET position = $1 WHERE id = $2 AND organization_id = $3',
        [stage.position, stage.id, orgId]
      );
    }

    res.json(formatResponse(null, 'Stages reordered successfully'));
  } catch (error) {
    console.error('Reorder stages error:', error);
    res.status(500).json({ message: 'Failed to reorder stages' });
  }
});

router.get('/board', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const stages = await pool.query(
      'SELECT * FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC',
      [orgId]
    );

    const board = await Promise.all(
      stages.rows.map(async (stage) => {
        const leads = await pool.query(
          `SELECT l.*, u.first_name as assigned_first_name, u.last_name as assigned_last_name
           FROM leads l
           LEFT JOIN users u ON l.assigned_to = u.id
           WHERE l.stage_id = $1
           ORDER BY l.updated_at DESC`,
          [stage.id]
        );
        
        return {
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: stage.position,
          leads: leads.rows.map(l => ({
            id: l.id,
            title: l.title,
            value: parseFloat(l.value) || 0,
            contactName: l.contact_name,
            company: l.company,
            priority: l.priority,
            assignedTo: l.assigned_to,
            assignedName: l.assigned_first_name ? `${l.assigned_first_name} ${l.assigned_last_name || ''}`.trim() : null
          }))
        };
      })
    );

    res.json(formatResponse({ board }));
  } catch (error) {
    console.error('Get board error:', error);
    res.status(500).json({ message: 'Failed to get pipeline board' });
  }
});

module.exports = router;
