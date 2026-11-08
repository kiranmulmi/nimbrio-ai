import type { AppInfo } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchAppInfo } from './api';

export function useAppInfo(): AsyncResource<AppInfo> {
  return useAsync(fetchAppInfo);
}
