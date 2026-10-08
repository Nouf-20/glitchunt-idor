-- Reset helper for local workshop use only.
DELETE FROM invoices;
DELETE FROM tickets;
DELETE FROM sessions;
DELETE FROM users;
DELETE FROM sqlite_sequence WHERE name IN ('users','sessions','tickets','invoices');
