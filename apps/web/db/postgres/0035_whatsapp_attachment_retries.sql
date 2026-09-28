ALTER TABLE whatsapp_send ADD COLUMN attachment_id TEXT REFERENCES whatsapp_attachment(id) ON DELETE SET NULL;
UPDATE whatsapp_send s SET attachment_id=a.id FROM whatsapp_attachment a WHERE a.send_id=s.id;
CREATE INDEX whatsapp_send_attachment ON whatsapp_send(attachment_id) WHERE attachment_id IS NOT NULL;
