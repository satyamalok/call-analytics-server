-- Call Analytics Database Initialization
-- This script runs automatically when PostgreSQL container starts

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create agents table with indexes
CREATE TABLE IF NOT EXISTS agents (
    agent_code VARCHAR(50) PRIMARY KEY,
    agent_name VARCHAR(100) NOT NULL,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'on_call', 'removed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create calls table with indexes
CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    agent_code VARCHAR(50) REFERENCES agents(agent_code) ON DELETE CASCADE,
    phone_number VARCHAR(20),
    contact_name VARCHAR(100),
    call_type VARCHAR(20) NOT NULL CHECK (call_type IN ('incoming', 'outgoing', 'missed')),
    talk_duration INTEGER DEFAULT 0 CHECK (talk_duration >= 0),
    total_duration INTEGER DEFAULT 0 CHECK (total_duration >= 0),
    call_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create agent reminder settings table
CREATE TABLE IF NOT EXISTS agent_reminder_settings (
    agent_code VARCHAR(50) PRIMARY KEY REFERENCES agents(agent_code) ON DELETE CASCADE,
    reminder_interval_minutes INTEGER DEFAULT 5 CHECK (reminder_interval_minutes > 0),
    reminders_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_calls_agent_date ON calls(agent_code, call_date);
CREATE INDEX IF NOT EXISTS idx_calls_date ON calls(call_date);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for agents table
DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for reminder settings
DROP TRIGGER IF EXISTS update_reminder_settings_updated_at ON agent_reminder_settings;
CREATE TRIGGER update_reminder_settings_updated_at
    BEFORE UPDATE ON agent_reminder_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert sample data (optional)
INSERT INTO agents (agent_code, agent_name, status) VALUES
('Agent1', 'Sample Agent 1', 'offline'),
('Agent2', 'Sample Agent 2', 'offline')
ON CONFLICT (agent_code) DO NOTHING;

-- Insert default reminder settings for existing agents
INSERT INTO agent_reminder_settings (agent_code, reminder_interval_minutes, reminders_enabled)
SELECT agent_code, 5, true 
FROM agents 
ON CONFLICT (agent_code) DO NOTHING;

-- Create trigger to auto-insert reminder settings for new agents
CREATE OR REPLACE FUNCTION create_default_reminder_settings()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO agent_reminder_settings (agent_code, reminder_interval_minutes, reminders_enabled)
    VALUES (NEW.agent_code, 5, true)
    ON CONFLICT (agent_code) DO NOTHING;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS auto_create_reminder_settings ON agents;
CREATE TRIGGER auto_create_reminder_settings
    AFTER INSERT ON agents
    FOR EACH ROW
    EXECUTE FUNCTION create_default_reminder_settings();

-- Create view for today's statistics
CREATE OR REPLACE VIEW today_stats AS
SELECT 
    a.agent_code,
    a.agent_name,
    a.status,
    COALESCE(SUM(c.talk_duration), 0) as today_talk_time,
    COUNT(c.id) as today_calls,
    MAX(c.created_at) as last_call_time
FROM agents a
LEFT JOIN calls c ON a.agent_code = c.agent_code 
    AND c.call_date = CURRENT_DATE
WHERE a.status != 'removed'
GROUP BY a.agent_code, a.agent_name, a.status
ORDER BY a.agent_code;

-- Grant permissions (if needed)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO admin;

-- Print completion message
DO $$
BEGIN
    RAISE NOTICE 'Call Analytics database initialized successfully with reminder settings!';
END $$;