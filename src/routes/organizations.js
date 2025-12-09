const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { formatResponse } = require('../utils/helpers');

router.use(authenticate);

router.get('/current', async (req, res) => {
  try {
    const orgId = req.organizationId;
    
    if (!orgId) {
      return res.status(404).json({ message: 'No organization found' });
    }

    const result = await pool.query(
      'SELECT * FROM organizations WHERE id = $1',
      [orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const org = result.rows[0];
    res.json(formatResponse({
      organization: {
        id: org.id,
        name: org.name,
        industry: org.industry,
        website: org.website,
        logoUrl: org.logo_url,
        address: org.address,
        phone: org.phone,
        email: org.email,
        createdAt: org.created_at
      }
    }));
  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ message: 'Failed to get organization' });
  }
});

router.put('/current', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { name, industry, website, logoUrl, address, phone, email } = req.body;

    const result = await pool.query(
      `UPDATE organizations SET
        name = COALESCE($1, name),
        industry = COALESCE($2, industry),
        website = COALESCE($3, website),
        logo_url = COALESCE($4, logo_url),
        address = COALESCE($5, address),
        phone = COALESCE($6, phone),
        email = COALESCE($7, email),
        updated_at = NOW()
      WHERE id = $8
      RETURNING *`,
      [name, industry, website, logoUrl, address, phone, email, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const org = result.rows[0];
    res.json(formatResponse({
      organization: {
        id: org.id,
        name: org.name,
        industry: org.industry,
        website: org.website,
        logoUrl: org.logo_url,
        address: org.address,
        phone: org.phone,
        email: org.email
      }
    }, 'Organization updated successfully'));
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ message: 'Failed to update organization' });
  }
});

router.get('/members', async (req, res) => {
  try {
    const orgId = req.organizationId;

    const result = await pool.query(
      `SELECT om.*, u.email, u.first_name, u.last_name, u.avatar_url
       FROM organization_members om
       LEFT JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC`,
      [orgId]
    );

    res.json(formatResponse({
      members: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        email: row.email || row.invited_email,
        firstName: row.first_name,
        lastName: row.last_name,
        avatarUrl: row.avatar_url,
        role: row.role,
        status: row.status,
        createdAt: row.created_at
      }))
    }));
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ message: 'Failed to get team members' });
  }
});

router.post('/members/invite', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const existing = await pool.query(
      `SELECT * FROM organization_members om
       LEFT JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1 AND (u.email = $2 OR om.invited_email = $2)`,
      [orgId, email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'User is already a member or has been invited' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    let memberId;
    if (userResult.rows.length > 0) {
      const result = await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role, status) 
         VALUES ($1, $2, $3, 'active') RETURNING *`,
        [orgId, userResult.rows[0].id, role || 'member']
      );
      memberId = result.rows[0].id;
    } else {
      const result = await pool.query(
        `INSERT INTO organization_members (organization_id, invited_email, role, status) 
         VALUES ($1, $2, $3, 'pending') RETURNING *`,
        [orgId, email, role || 'member']
      );
      memberId = result.rows[0].id;
    }

    res.status(201).json(formatResponse({ memberId }, 'Invitation sent successfully'));
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ message: 'Failed to invite member' });
  }
});

router.delete('/members/:memberId', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { memberId } = req.params;

    const member = await pool.query(
      'SELECT * FROM organization_members WHERE id = $1 AND organization_id = $2',
      [memberId, orgId]
    );

    if (member.rows.length === 0) {
      return res.status(404).json({ message: 'Member not found' });
    }

    if (member.rows[0].role === 'owner') {
      return res.status(400).json({ message: 'Cannot remove the owner' });
    }

    await pool.query(
      'DELETE FROM organization_members WHERE id = $1 AND organization_id = $2',
      [memberId, orgId]
    );

    res.json(formatResponse(null, 'Member removed successfully'));
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ message: 'Failed to remove member' });
  }
});

router.put('/members/:memberId/role', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const { memberId } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: 'Role is required' });
    }

    const result = await pool.query(
      `UPDATE organization_members SET role = $1 
       WHERE id = $2 AND organization_id = $3 AND role != 'owner'
       RETURNING *`,
      [role, memberId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Member not found or cannot change owner role' });
    }

    res.json(formatResponse({ member: result.rows[0] }, 'Role updated successfully'));
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ message: 'Failed to update role' });
  }
});

router.get('/my-role', async (req, res) => {
  try {
    const orgId = req.organizationId;
    const userId = req.userId;

    const result = await pool.query(
      'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [orgId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Not a member of this organization' });
    }

    res.json(formatResponse({ role: result.rows[0].role }));
  } catch (error) {
    console.error('Get role error:', error);
    res.status(500).json({ message: 'Failed to get role' });
  }
});

module.exports = router;
