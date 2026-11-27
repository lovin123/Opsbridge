process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://fieldops:fieldops@localhost:5433/fieldops_test';
process.env.REDIS_URL = 'redis://127.0.0.1:6380';
process.env.QUEUE_DRIVER = 'inline';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.API_PORT = '4000';
process.env.SESSION_COOKIE_NAME = 'fieldops_session';
process.env.SESSION_TTL_HOURS = '168';
