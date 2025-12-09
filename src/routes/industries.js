const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { formatResponse } = require('../utils/helpers');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM industries ORDER BY name ASC');

    res.json(formatResponse({
      industries: result.rows.map(row => ({
        id: row.id,
        name: row.name
      }))
    }));
  } catch (error) {
    console.error('Get industries error:', error);
    res.status(500).json({ message: 'Failed to get industries' });
  }
});

module.exports = router;
