-- Execute este arquivo conectado ao banco administrativo 'postgres'.
-- A instrucao CREATE DATABASE nao deve ser executada dentro de BEGIN/COMMIT.
CREATE DATABASE marketplace_solidario
    WITH ENCODING = 'UTF8'
    TEMPLATE = template0;
-- Depois, conecte-se ao novo banco marketplace_solidario.
