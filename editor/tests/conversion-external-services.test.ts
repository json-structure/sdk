import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StartedTestContainer } from 'testcontainers';
import { NodeProcessExecutableLauncher } from '../src/conversion/process.js';
import type { ConversionOptionValues } from '../src/conversion/types.js';
import type { ConversionProgress, ConversionWorkerResult } from '../src/conversion/worker.js';

const enabled = process.env.JSON_STRUCTURE_TESTCONTAINERS === '1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const password = 'Integration!42';
const sqlServerPassword = 'Integration!42Sql';
const database = 'integration';
const username = 'editor';

async function runPackaged(commandId: string, options: ConversionOptionValues, progress: (event: ConversionProgress) => void): Promise<ConversionWorkerResult> {
  return new NodeProcessExecutableLauncher(resolve(process.cwd(), 'src/conversion')).invoke({
    executablePath: 'worker-runtime/converter-worker.cjs',
    arguments: [],
    request: {
      operationId: randomUUID(),
      commandId,
      sourceName: `${commandId.replace(/\W/g, '-')}-external-service`,
      source: encoder.encode(''),
      options,
      preview: true,
    },
    signal: new AbortController().signal,
    onProgress: progress,
  });
}

function decodedStructure(result: ConversionWorkerResult): Record<string, unknown> {
  const output = result.files['schema.struct.json'];
  if (!output) throw new Error(`Expected schema.struct.json, received ${Object.keys(result.files).join(', ') || 'no files'}.`);
  return JSON.parse(decoder.decode(output)) as Record<string, unknown>;
}

async function execOrThrow(container: StartedTestContainer, command: string[], attempts = 30): Promise<void> {
  let message = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await container.exec(command);
    if (result.exitCode === 0) return;
    message = result.stderr || result.output || `Container command exited with ${result.exitCode}.`;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(message);
}

async function stop(container: StartedTestContainer | undefined): Promise<void> {
  await container?.stop();
}

async function executeKusto(uri: string, databaseName: string, command: string, attempts = 30): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${uri}/v1/rest/mgmt`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token',
          'content-type': 'application/json; charset=utf-8',
          'x-ms-app': 'json-structure-editor-tests',
          'x-ms-client-request-id': `json-structure-editor-tests;${randomUUID()}`,
        },
        body: JSON.stringify({ db: databaseName, csl: command, properties: { Options: {} } }),
      });
      const body = await response.text();
      if (!response.ok || /OneApiErrors|"error"/i.test(body)) throw new Error(`Kusto returned ${response.status}: ${body}`);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Kusto did not become ready.');
}

describe.runIf(enabled)('external-service conversion integration', () => {
  let postgres: StartedTestContainer | undefined;
  let mysql: StartedTestContainer | undefined;
  let sqlServer: StartedTestContainer | undefined;
  let kusto: StartedTestContainer | undefined;
  let fakeAzureCliDirectory: string | undefined;
  let previousPath: string | undefined;

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers');
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: database, POSTGRES_USER: username, POSTGRES_PASSWORD: password })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
      .start();
    await execOrThrow(postgres, ['psql', '-U', username, '-d', database, '-c', `
      CREATE TABLE integration_events (
        id BIGSERIAL PRIMARY KEY,
        event_name VARCHAR(80) NOT NULL,
        payload JSONB
      );
      CREATE TABLE ignored_events (id INTEGER PRIMARY KEY);
      INSERT INTO integration_events(event_name, payload) VALUES
        ('created', '{"customer":"Ada","priority":3}'),
        ('updated', '{"customer":"Grace","priority":5}');
    `]);

    mysql = await new GenericContainer('mysql:8.4')
      .withEnvironment({ MYSQL_DATABASE: database, MYSQL_USER: username, MYSQL_PASSWORD: password, MYSQL_ROOT_PASSWORD: password })
      .withExposedPorts(3306)
      .withWaitStrategy(Wait.forLogMessage(/ready for connections.*port: 3306/i))
      .start();
    await execOrThrow(mysql, ['mysql', `-u${username}`, `-p${password}`, database, '-e', `
      CREATE TABLE integration_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        event_name VARCHAR(80) NOT NULL,
        payload JSON
      );
      CREATE TABLE ignored_events (id INTEGER PRIMARY KEY);
      INSERT INTO integration_events(event_name, payload) VALUES
        ('created', JSON_OBJECT('customer', 'Ada', 'priority', 3)),
        ('updated', JSON_OBJECT('customer', 'Grace', 'priority', 5));
    `]);

    sqlServer = await new GenericContainer('mcr.microsoft.com/mssql/server:2022-latest')
      .withEnvironment({ ACCEPT_EULA: 'Y', MSSQL_SA_PASSWORD: sqlServerPassword })
      .withExposedPorts(1433)
      .withWaitStrategy(Wait.forLogMessage(/SQL Server is now ready for client connections/i))
      .start();
    await execOrThrow(sqlServer, ['/bin/bash', '-c', `
      SQLCMD=$([ -x /opt/mssql-tools18/bin/sqlcmd ] && echo /opt/mssql-tools18/bin/sqlcmd || echo /opt/mssql-tools/bin/sqlcmd)
      "$SQLCMD" -S localhost -U sa -P '${sqlServerPassword}' -C -Q "
        CREATE DATABASE ${database};
      "
      "$SQLCMD" -S localhost -U sa -P '${sqlServerPassword}' -C -d ${database} -Q "
        CREATE TABLE integration_events (
          id BIGINT IDENTITY(1,1) PRIMARY KEY,
          event_name NVARCHAR(80) NOT NULL,
          payload NVARCHAR(MAX)
        );
        CREATE TABLE ignored_events (id INTEGER PRIMARY KEY);
        INSERT INTO integration_events(event_name, payload) VALUES
          ('created', '{\"customer\":\"Ada\",\"priority\":3}'),
          ('updated', '{\"customer\":\"Grace\",\"priority\":5}');
      "
    `]);

    kusto = await new GenericContainer('mcr.microsoft.com/azuredataexplorer/kustainer-linux:latest')
      .withEnvironment({ ACCEPT_EULA: 'Y' })
      .withExposedPorts(8080)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    const kustoUri = `http://${kusto.getHost()}:${kusto.getMappedPort(8080)}`;
    await executeKusto(kustoUri, 'NetDefaultDB', `.create database ${database} persist (@"/kustodata/dbs/${database}/md", @"/kustodata/dbs/${database}/data")`);
    await executeKusto(kustoUri, database, '.create table IntegrationEvents (id:string, event_type:string, payload:dynamic)');
    await executeKusto(kustoUri, database, `.ingest inline into table IntegrationEvents with (format="json") <|\n{"id":"1","event_type":"created","payload":{"customer":"Ada","priority":3}}`);

    fakeAzureCliDirectory = await mkdtemp(join(tmpdir(), 'json-structure-fake-az-'));
    const fakeAzureCli = process.platform === 'win32' ? join(fakeAzureCliDirectory, 'az.cmd') : join(fakeAzureCliDirectory, 'az');
    const response = '{"accessToken":"token","expiresOn":"2099-01-01 00:00:00.000000","subscription":"integration","tenant":"integration","tokenType":"Bearer"}';
    await writeFile(fakeAzureCli, process.platform === 'win32' ? `@echo off\r\necho ${response}\r\n` : `#!/bin/sh\nprintf '%s\\n' '${response}'\n`);
    if (process.platform !== 'win32') await chmod(fakeAzureCli, 0o755);
    previousPath = process.env.PATH;
    process.env.PATH = `${fakeAzureCliDirectory}${delimiter}${previousPath ?? ''}`;
  }, 180_000);

  afterAll(async () => {
    process.env.PATH = previousPath;
    await Promise.allSettled([stop(postgres), stop(mysql), stop(sqlServer), stop(kusto)]);
    if (fakeAzureCliDirectory) await rm(fakeAzureCliDirectory, { recursive: true, force: true });
  });

  it.each([
    ['PostgreSQL', 'postgres', () => postgres!, 5432, 'postgresql', username, password],
    ['MySQL', 'mysql', () => mysql!, 3306, 'mysql', username, password],
    ['SQL Server', 'sqlserver', () => sqlServer!, 1433, 'mssql', 'sa', sqlServerPassword],
  ] as const)('connects to %s and makes live SQL options effective', async (_name, dialect, getContainer, containerPort, scheme, databaseUser, databasePassword) => {
    const container = getContainer();
    const progress = vi.fn<(event: ConversionProgress) => void>();
    const result = await runPackaged('import.structurize.sql2s', {
      connection_string: `${scheme}://${container.getHost()}:${container.getMappedPort(containerPort)}/${database}`,
      username: databaseUser,
      password: databasePassword,
      database,
      table_name: 'integration_events',
      namespace: `integration.${dialect}`,
      dialect,
      emit_cloudevents: true,
      sample_size: 2,
      infer_json: true,
      infer_xml: false,
      infer_choices: false,
      naming: 'snake',
      avro_encoding: false,
    }, progress);

    const structure = decodedStructure(result);
    const serialized = JSON.stringify(structure);
    expect(serialized).toContain('integration_events');
    expect(serialized).not.toContain('ignored_events');
    expect(serialized).toContain('payload');
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['read', 'convert', 'finalize']);
  }, 120_000);

  it('reports a live SQL failure without a false finalize or success result', async () => {
    const progress = vi.fn<(event: ConversionProgress) => void>();
    const container = postgres!;
    await expect(runPackaged('import.structurize.sql2s', {
      connection_string: `postgresql://${container.getHost()}:${container.getMappedPort(5432)}/${database}`,
      username,
      password: 'wrong-password',
      database,
      table_name: 'integration_events',
      dialect: 'postgres',
    }, progress)).rejects.toThrow(/password|authentication|failed/i);
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['read', 'convert']);
  }, 60_000);

  it('connects to Kustainer and makes live Kusto parameters effective', async () => {
    const progress = vi.fn<(event: ConversionProgress) => void>();
    const result = await runPackaged('import.structurize.k2s', {
      kusto_uri: `http://${kusto!.getHost()}:${kusto!.getMappedPort(8080)}`,
      kusto_database: database,
      table_name: 'IntegrationEvents',
      base_id: 'https://integration.example.test/kusto/',
      emit_cloudevents: true,
      emit_xregistry: false,
      sample_size: 1,
      infer_choices: true,
      choice_depth: 2,
      infer_enums: true,
    }, progress);

    const serialized = JSON.stringify(decodedStructure(result));
    expect(serialized).toContain('IntegrationEvents');
    expect(serialized).toContain('https://integration.example.test/kusto/');
    expect(serialized).toContain('payload');
    expect(progress.mock.calls.map(([event]) => event.phase)).toEqual(['read', 'convert', 'finalize']);
  }, 120_000);
});
