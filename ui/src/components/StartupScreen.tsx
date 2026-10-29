import React from 'react';
import { AutodetectHomeScreen, type AutodetectHomeScreenProps } from './AutodetectHomeScreen';

export type StartupScreenProps = AutodetectHomeScreenProps;

export const StartupScreen: React.FC<StartupScreenProps> = (props) => {
  return <AutodetectHomeScreen {...props} />;
};
