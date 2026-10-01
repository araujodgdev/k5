-- Heavy Node jobs must not reserve the healthy edge worker's WhatsApp/email pass.
ALTER TABLE integration_circuit DROP CONSTRAINT integration_circuit_id_check;
ALTER TABLE integration_circuit ADD CHECK (id IN (1,2));
INSERT INTO integration_circuit(id) VALUES(2);
