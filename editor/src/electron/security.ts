const developmentPort = '5173';
const developmentHost = '127.0.0.1';

export const deniedWindowOpen = { action: 'deny' } as const;

export interface IpcSenderFacts {
  readonly senderId: number;
  readonly expectedSenderId: number;
  readonly senderDestroyed: boolean;
  readonly isMainFrame: boolean;
  readonly frameUrl: string;
  readonly expectedUrl: string;
}

export function selectDevelopmentUrl(isPackaged: boolean, candidate: string | undefined): string | undefined {
  if (isPackaged || !candidate) return undefined;
  let url: URL;
  try { url = new URL(candidate); }
  catch { return undefined; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.hostname !== developmentHost || url.port !== developmentPort ||
      url.pathname !== '/' || url.username || url.password || url.search || url.hash) return undefined;
  return url.href;
}

export function isAllowedRendererNavigation(candidateUrl: string, expectedUrl: string): boolean {
  return candidateUrl === expectedUrl;
}

export function isTrustedIpcSender(facts: IpcSenderFacts): boolean {
  return facts.senderId === facts.expectedSenderId && !facts.senderDestroyed && facts.isMainFrame &&
    facts.frameUrl === facts.expectedUrl;
}

export function selectInitialDocumentArgument(arguments_: readonly string[]): string | undefined {
  return arguments_.find((argument) => !argument.startsWith('-') && /\.json$/i.test(argument));
}