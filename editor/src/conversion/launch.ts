export interface DiscoveredApplication { id: string; displayName: string; executablePath?: string }
export interface ApplicationDiscovery { discover(targetFormat: string): Promise<readonly DiscoveredApplication[]> }
export interface HostLaunchAdapter { launch(path: string, application?: DiscoveredApplication): Promise<void> }

export interface LaunchPreference {
  autoOpen?: boolean;
  application?: DiscoveredApplication;
}

export function shouldAutoOpen(preference: LaunchPreference | undefined, commandDefault = true): boolean {
  return preference?.autoOpen ?? commandDefault;
}