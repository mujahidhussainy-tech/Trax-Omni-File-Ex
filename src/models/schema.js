const pool = require('../config/database');

const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        avatar_url TEXT,
        is_verified BOOLEAN DEFAULT false,
        google_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- OTP table for verification
      CREATE TABLE IF NOT EXISTS otps (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        otp VARCHAR(6) NOT NULL,
        type VARCHAR(20) DEFAULT 'registration',
        verified BOOLEAN DEFAULT false,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Organizations table
      CREATE TABLE IF NOT EXISTS organizations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        industry VARCHAR(100),
        website VARCHAR(255),
        logo_url TEXT,
        address TEXT,
        phone VARCHAR(20),
        email VARCHAR(255),
        owner_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Organization members (team)
      CREATE TABLE IF NOT EXISTS organization_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'member',
        invited_email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(organization_id, user_id)
      );

      -- Subscription plans
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        billing_period VARCHAR(20) DEFAULT 'monthly',
        features JSONB,
        max_users INTEGER DEFAULT 1,
        max_leads INTEGER DEFAULT 100,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Organization subscriptions
      CREATE TABLE IF NOT EXISTS subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        plan_id UUID REFERENCES subscription_plans(id),
        status VARCHAR(20) DEFAULT 'active',
        trial_ends_at TIMESTAMP,
        current_period_start TIMESTAMP,
        current_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Pipeline stages
      CREATE TABLE IF NOT EXISTS pipeline_stages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(20) DEFAULT '#7C3AED',
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Leads table
      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        value DECIMAL(15,2) DEFAULT 0,
        stage_id UUID REFERENCES pipeline_stages(id),
        status VARCHAR(50) DEFAULT 'new',
        source VARCHAR(100),
        priority VARCHAR(20) DEFAULT 'medium',
        assigned_to UUID REFERENCES users(id),
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        company VARCHAR(255),
        notes TEXT,
        expected_close_date DATE,
        lead_score INTEGER DEFAULT 0,
        last_activity_at TIMESTAMP,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add lead_score column if not exists (for existing databases)
      DO $$ BEGIN
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Contacts table
      CREATE TABLE IF NOT EXISTS contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100),
        email VARCHAR(255),
        phone VARCHAR(50),
        company VARCHAR(255),
        job_title VARCHAR(100),
        address TEXT,
        notes TEXT,
        type VARCHAR(20) DEFAULT 'lead',
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Lead activities
      CREATE TABLE IF NOT EXISTS lead_activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Integrations
      CREATE TABLE IF NOT EXISTS integrations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        config JSONB,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add updated_at column if not exists (for existing databases)
      DO $$ BEGIN
        ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Call logs for tracking phone calls
      CREATE TABLE IF NOT EXISTS call_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        phone_number VARCHAR(50) NOT NULL,
        call_type VARCHAR(20) DEFAULT 'outbound',
        duration_seconds INTEGER DEFAULT 0,
        outcome VARCHAR(50),
        notes TEXT,
        called_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Follow-up reminders
      CREATE TABLE IF NOT EXISTS reminders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        reminder_date TIMESTAMP NOT NULL,
        reminder_type VARCHAR(50) DEFAULT 'follow_up',
        is_completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Team activity tracking
      CREATE TABLE IF NOT EXISTS team_activities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        action_type VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id UUID,
        entity_name VARCHAR(255),
        description TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Index for faster activity queries
      CREATE INDEX IF NOT EXISTS idx_team_activities_org_created 
        ON team_activities(organization_id, created_at DESC);

      -- Social leads table for Facebook/Instagram imported leads
      CREATE TABLE IF NOT EXISTS social_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        platform VARCHAR(50) NOT NULL,
        platform_lead_id VARCHAR(255) NOT NULL,
        page_id VARCHAR(255),
        form_id VARCHAR(255),
        lead_data JSONB,
        status VARCHAR(50) DEFAULT 'pending',
        converted_lead_id UUID REFERENCES leads(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(platform, platform_lead_id)
      );

      -- Index for faster social leads queries
      CREATE INDEX IF NOT EXISTS idx_social_leads_org_platform 
        ON social_leads(organization_id, platform, created_at DESC);

      -- Voice notes table for leads and contacts
      CREATE TABLE IF NOT EXISTS voice_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
        title VARCHAR(255),
        audio_data TEXT NOT NULL,
        duration_seconds INTEGER DEFAULT 0,
        file_size INTEGER DEFAULT 0,
        mime_type VARCHAR(50) DEFAULT 'audio/m4a',
        transcription TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Index for faster voice note queries
      CREATE INDEX IF NOT EXISTS idx_voice_notes_lead 
        ON voice_notes(lead_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_voice_notes_contact 
        ON voice_notes(contact_id, created_at DESC);

      -- Industries lookup
      CREATE TABLE IF NOT EXISTS industries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Insert default industries if not exist
      INSERT INTO industries (name) VALUES 
        ('Technology'),
        ('Healthcare'),
        ('Finance'),
        ('Real Estate'),
        ('Retail'),
        ('Manufacturing'),
        ('Education'),
        ('Consulting'),
        ('Marketing'),
        ('Other')
      ON CONFLICT (name) DO NOTHING;

      -- Insert default subscription plans if not exist
      INSERT INTO subscription_plans (id, name, price, billing_period, features, max_users, max_leads) VALUES
        ('00000000-0000-0000-0000-000000000001', 'Trial', 0, 'monthly', '{"features": ["Basic CRM", "Up to 50 leads", "1 team member"]}', 1, 50),
        ('00000000-0000-0000-0000-000000000002', 'Starter', 29, 'monthly', '{"features": ["Full CRM", "Up to 500 leads", "3 team members", "Email support"]}', 3, 500),
        ('00000000-0000-0000-0000-000000000003', 'Professional', 79, 'monthly', '{"features": ["Full CRM", "Unlimited leads", "10 team members", "Priority support", "Integrations"]}', 10, -1),
        ('00000000-0000-0000-0000-000000000004', 'Business', 199, 'monthly', '{"features": ["Full CRM", "Unlimited leads", "Unlimited team members", "Dedicated support", "All integrations", "API access"]}', -1, -1)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { initializeDatabase };
