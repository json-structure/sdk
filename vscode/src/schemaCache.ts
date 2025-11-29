import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

export interface SchemaResult {
    schema: unknown | null;
    error?: string;
}

interface CacheEntry {
    schema: unknown;
    etag?: string;
    timestamp: number;
    is404?: boolean;
    errorMessage?: string;
}

interface WorkspaceSchemaEntry {
    uri: vscode.Uri;
    id: string;
    schema: unknown;
    timestamp: number;
}

/**
 * Cache for fetched remote schemas with ETag support
 */
export class SchemaCache {
    private cache: Map<string, CacheEntry> = new Map();
    private workspaceSchemas: Map<string, WorkspaceSchemaEntry> = new Map();
    private workspaceScanTimestamp: number = 0;
    private context: vscode.ExtensionContext;
    private isScanning: boolean = false;
    private scanPromise: Promise<void> | null = null;
    private initialScanPromise: Promise<void>;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadCache();
        
        // Initial scan of workspace schemas - store promise for waiting
        this.initialScanPromise = this.scanWorkspaceSchemas();
        
        // Watch for schema file changes
        this.setupFileWatcher(context);
    }
    
    /**
     * Set up file watcher for schema files
     */
    private setupFileWatcher(context: vscode.ExtensionContext): void {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*.struct.json');
        
        watcher.onDidCreate((uri) => {
            this.updateWorkspaceSchema(uri);
        });
        
        watcher.onDidChange((uri) => {
            this.updateWorkspaceSchema(uri);
        });
        
        watcher.onDidDelete((uri) => {
            // Remove from cache by finding the entry with this URI
            for (const [id, entry] of this.workspaceSchemas.entries()) {
                if (entry.uri.fsPath === uri.fsPath) {
                    this.workspaceSchemas.delete(id);
                    break;
                }
            }
        });
        
        context.subscriptions.push(watcher);
    }
    
    /**
     * Update a single workspace schema
     */
    private async updateWorkspaceSchema(uri: vscode.Uri): Promise<void> {
        try {
            const content = await fs.promises.readFile(uri.fsPath, 'utf-8');
            const schema = JSON.parse(content);
            
            if (schema && typeof schema === 'object' && '$id' in schema && typeof schema.$id === 'string') {
                this.workspaceSchemas.set(schema.$id, {
                    uri,
                    id: schema.$id,
                    schema,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            // Ignore parse errors for individual files
        }
    }
    
    /**
     * Scan workspace for all schema files with $id
     */
    async scanWorkspaceSchemas(): Promise<void> {
        // Avoid concurrent scans
        if (this.isScanning) {
            return this.scanPromise || Promise.resolve();
        }
        
        this.isScanning = true;
        this.scanPromise = this.doScanWorkspaceSchemas();
        
        try {
            await this.scanPromise;
        } finally {
            this.isScanning = false;
            this.scanPromise = null;
        }
    }
    
    private async doScanWorkspaceSchemas(): Promise<void> {
        const files = await vscode.workspace.findFiles('**/*.struct.json', '**/node_modules/**');
        
        console.log(`JSON Structure: Scanning ${files.length} schema files in workspace`);
        
        for (const file of files) {
            await this.updateWorkspaceSchema(file);
        }
        
        console.log(`JSON Structure: Found ${this.workspaceSchemas.size} schemas with $id`);
        for (const [id] of this.workspaceSchemas) {
            console.log(`  - ${id}`);
        }
        
        this.workspaceScanTimestamp = Date.now();
    }
    
    /**
     * Find a schema in the workspace by its $id
     */
    async findWorkspaceSchema(schemaId: string): Promise<unknown | null> {
        // Always wait for the initial scan to complete first
        await this.initialScanPromise;
        
        // Wait for any ongoing rescan to complete
        if (this.scanPromise) {
            await this.scanPromise;
        }
        
        // Try exact match first
        let entry = this.workspaceSchemas.get(schemaId);
        
        // Try normalized matches (with/without trailing slash, fragment)
        if (!entry) {
            const normalizedId = schemaId.replace(/#$/, ''); // Remove trailing #
            entry = this.workspaceSchemas.get(normalizedId);
        }
        if (!entry) {
            const withFragment = schemaId + '#';
            entry = this.workspaceSchemas.get(withFragment);
        }
        
        if (entry) {
            return entry.schema;
        }
        
        return null;
    }

    /**
     * Get a schema from the cache or fetch it
     * @param uri The schema URI (may be a local file path or remote URL)
     * @param documentUri Optional document URI for resolving relative paths
     * @returns SchemaResult with schema and optional error message
     */
    async getSchema(uri: string, documentUri?: vscode.Uri): Promise<SchemaResult> {
        const config = vscode.workspace.getConfiguration('jsonStructure');
        const schemaMapping = config.get<Record<string, string>>('schemaMapping', {});
        const cacheTTL = config.get<number>('cacheTTLMinutes', 60) * 60 * 1000;

        // 1. Check if there's a local mapping for this URI
        if (schemaMapping[uri]) {
            const localPath = this.resolveLocalPath(schemaMapping[uri]);
            const schema = await this.loadLocalSchema(localPath);
            if (schema) {
                return { schema };
            }
            return { schema: null, error: `Mapped local file not found: ${localPath}` };
        }

        // 2. Check if it's a local file path or relative path
        if (uri.startsWith('file://') || (!uri.startsWith('http://') && !uri.startsWith('https://'))) {
            let localPath = uri.startsWith('file://') 
                ? uri.replace('file://', '') 
                : uri;
            
            // Resolve relative paths against document location
            if (!path.isAbsolute(localPath) && documentUri) {
                const documentDir = path.dirname(documentUri.fsPath);
                localPath = path.resolve(documentDir, localPath);
            }
            
            const schema = await this.loadLocalSchema(localPath);
            if (schema) {
                return { schema };
            }
            return { schema: null, error: `Local file not found: ${localPath}` };
        }
        
        // 3. Check workspace schemas for matching $id (always wait for scan to complete first)
        const workspaceSchema = await this.findWorkspaceSchema(uri);
        if (workspaceSchema) {
            // Don't proceed to network fetch - we have a local copy
            return { schema: workspaceSchema };
        }

        // 4. Check cache for remote schemas
        const cached = this.cache.get(uri);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < cacheTTL) {
                if (cached.is404) {
                    return { 
                        schema: null, 
                        error: cached.errorMessage || `Schema not found at ${uri} (cached 404)` 
                    };
                }
                return { schema: cached.schema };
            }
        }

        // 5. Fetch remote schema - only if not found locally
        return this.fetchRemoteSchema(uri, cached?.etag);
    }

    /**
     * Resolve a local path, including workspace folder variables
     */
    private resolveLocalPath(localPath: string): string {
        // Replace ${workspaceFolder} with actual workspace folder
        if (localPath.includes('${workspaceFolder}')) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
            localPath = localPath.replace('${workspaceFolder}', workspaceFolder);
        }

        // Handle relative paths
        if (!path.isAbsolute(localPath) && vscode.workspace.workspaceFolders?.[0]) {
            localPath = path.join(
                vscode.workspace.workspaceFolders[0].uri.fsPath,
                localPath
            );
        }

        return localPath;
    }

    /**
     * Load a schema from a local file
     */
    private async loadLocalSchema(filePath: string): Promise<unknown | null> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`Failed to load local schema: ${filePath}`, error);
            return null;
        }
    }

    /**
     * Fetch a schema from a remote URL
     */
    private async fetchRemoteSchema(url: string, etag?: string): Promise<SchemaResult> {
        return new Promise((resolve) => {
            const protocol = url.startsWith('https://') ? https : http;
            
            const headers: Record<string, string> = {
                'Accept': 'application/json',
                'User-Agent': 'VSCode-JSONStructure/0.1.0'
            };
            
            if (etag) {
                headers['If-None-Match'] = etag;
            }

            const req = protocol.get(url, { headers }, (res) => {
                // Handle 304 Not Modified
                if (res.statusCode === 304) {
                    const cached = this.cache.get(url);
                    if (cached) {
                        cached.timestamp = Date.now();
                        this.saveCache();
                        resolve({ schema: cached.schema });
                        return;
                    }
                }

                // Handle 404
                if (res.statusCode === 404) {
                    const errorMessage = `Schema not found at '${url}' (HTTP 404)`;
                    this.cache.set(url, {
                        schema: null,
                        timestamp: Date.now(),
                        is404: true,
                        errorMessage
                    });
                    this.saveCache();
                    resolve({ schema: null, error: errorMessage });
                    return;
                }

                // Handle other errors
                if (!res.statusCode || res.statusCode >= 400) {
                    const errorMessage = `Failed to fetch schema from '${url}': HTTP ${res.statusCode}`;
                    console.error(errorMessage);
                    resolve({ schema: null, error: errorMessage });
                    return;
                }

                // Read body
                let body = '';
                res.on('data', (chunk: Buffer) => {
                    body += chunk.toString();
                });
                
                res.on('end', () => {
                    try {
                        const schema = JSON.parse(body);
                        const newEtag = res.headers['etag'] as string | undefined;
                        
                        this.cache.set(url, {
                            schema,
                            etag: newEtag,
                            timestamp: Date.now()
                        });
                        this.saveCache();
                        
                        resolve({ schema });
                    } catch (error) {
                        const errorMessage = `Failed to parse schema from '${url}': Invalid JSON`;
                        console.error(errorMessage, error);
                        resolve({ schema: null, error: errorMessage });
                    }
                });
            });

            req.on('error', (error: NodeJS.ErrnoException) => {
                let errorMessage: string;
                const hostname = new URL(url).hostname;
                if (error.code === 'ENOTFOUND') {
                    errorMessage = `Unable to load schema from '${url}': getaddrinfo ENOTFOUND ${hostname}`;
                } else if (error.code === 'ECONNREFUSED') {
                    errorMessage = `Unable to connect to '${url}': Connection refused`;
                } else if (error.code === 'ETIMEDOUT') {
                    errorMessage = `Unable to load schema from '${url}': Connection timed out`;
                } else {
                    errorMessage = `Unable to load schema from '${url}': ${error.message}`;
                }
                console.error(errorMessage);
                resolve({ schema: null, error: errorMessage });
            });

            // Set timeout
            req.setTimeout(10000, () => {
                req.destroy();
                const errorMessage = `Unable to load schema from '${url}': Request timed out`;
                console.error(errorMessage);
                resolve({ schema: null, error: errorMessage });
            });
        });
    }

    /**
     * Clear the schema cache (both remote and workspace)
     */
    clearCache(): void {
        this.cache.clear();
        this.workspaceSchemas.clear();
        this.workspaceScanTimestamp = 0;
        this.context.globalState.update('schemaCache', undefined);
        
        // Rescan workspace schemas
        this.scanWorkspaceSchemas();
    }

    /**
     * Load cache from global state
     */
    private loadCache(): void {
        const saved = this.context.globalState.get<[string, CacheEntry][]>('schemaCache');
        if (saved) {
            this.cache = new Map(saved);
        }
    }

    /**
     * Save cache to global state
     */
    private saveCache(): void {
        const entries = Array.from(this.cache.entries());
        this.context.globalState.update('schemaCache', entries);
    }
}
