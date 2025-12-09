const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse, paginate } = require('../utils/helpers');
const { logActivity } = require('./team-activity');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, type } = req.query;
    const { limit: queryLimit, offset } = paginate(page, limit);
    const orgId = req.organizationId;

    let whereClause = 'WHERE organization_id = $1';
    let params = [orgId];
    let paramIndex = 2;

    if (search) {
      whereClause += ` AND (first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR company ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM contacts ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT * FROM contacts 
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, queryLimit, offset]
    );

    res.json(formatResponse({
      contacts: result.rows.map(row => ({
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        jobTitle: row.job_title,
        address: row.address,
        notes: row.notes,
        type: row.type,
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
    console.error('Get contacts error:', error);
    res.status(500).json({ message: 'Failed to get contacts' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;

    const result = await pool.query(
      'SELECT * FROM contacts WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const row = result.rows[0];
    res.json(formatResponse({
      contact: {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        jobTitle: row.job_title,
        address: row.address,
        notes: row.notes,
        type: row.type,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    }));
  } catch (error) {
    console.error('Get contact error:', error);
    res.status(500).json({ message: 'Failed to get contact' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, company, jobTitle, address, notes, type } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    console.log('Contact create request - orgId:', orgId, 'userId:', userId, 'body:', JSON.stringify(req.body));

    if (!orgId) {
      console.error('Contact creation failed: No organization ID in request');
      return res.status(400).json({ message: 'Organization not found. Please log out and log back in.' });
    }

    if (!userId) {
      console.error('Contact creation failed: No user ID in request');
      return res.status(400).json({ message: 'User authentication error. Please log in again.' });
    }

    if (!firstName) {
      return res.status(400).json({ message: 'First name is required' });
    }

    const result = await pool.query(
      `INSERT INTO contacts (
        organization_id, first_name, last_name, email, phone, 
        company, job_title, address, notes, type, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [orgId, firstName, lastName || '', email || '', phone || '', company || '', jobTitle || '', address || '', notes || '', type || 'lead', userId]
    );

    const row = result.rows[0];
    const contactName = [firstName, lastName].filter(Boolean).join(' ') || 'Unnamed Contact';
    logActivity(orgId, userId, 'create', 'contact', row.id, contactName, `Created contact "${contactName}"`);

    res.status(201).json(formatResponse({
      contact: {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        jobTitle: row.job_title,
        address: row.address,
        notes: row.notes,
        type: row.type,
        createdAt: row.created_at
      }
    }, 'Contact created successfully'));
  } catch (error) {
    console.error('Create contact error:', error.message, error.stack);
    res.status(500).json({ message: 'Failed to create contact: ' + error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, phone, company, jobTitle, address, notes, type } = req.body;
    const orgId = req.organizationId;
    const userId = req.userId;

    const result = await pool.query(
      `UPDATE contacts SET
        first_name = COALESCE($1, first_name),
        last_name = COALESCE($2, last_name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        company = COALESCE($5, company),
        job_title = COALESCE($6, job_title),
        address = COALESCE($7, address),
        notes = COALESCE($8, notes),
        type = COALESCE($9, type),
        updated_at = NOW()
      WHERE id = $10 AND organization_id = $11
      RETURNING *`,
      [firstName, lastName, email, phone, company, jobTitle, address, notes, type, id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const row = result.rows[0];
    const contactName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed Contact';
    logActivity(orgId, userId, 'update', 'contact', id, contactName, `Updated contact "${contactName}"`);

    res.json(formatResponse({
      contact: {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        jobTitle: row.job_title,
        address: row.address,
        notes: row.notes,
        type: row.type,
        updatedAt: row.updated_at
      }
    }, 'Contact updated successfully'));
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ message: 'Failed to update contact' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.organizationId;
    const userId = req.userId;

    const result = await pool.query(
      'DELETE FROM contacts WHERE id = $1 AND organization_id = $2 RETURNING *',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Contact not found' });
    }

    const row = result.rows[0];
    const contactName = [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unnamed Contact';
    logActivity(orgId, userId, 'delete', 'contact', id, contactName, `Deleted contact "${contactName}"`);

    res.json(formatResponse(null, 'Contact deleted successfully'));
  } catch (error) {
    console.error('Delete contact error:', error);
    res.status(500).json({ message: 'Failed to delete contact' });
  }
});

module.exports = router;
