import { config } from '../config';

export const missionPollInterval =
  config.dataMode === 'live' && config.backendStyle === 'missions' ? 3000 : false;
