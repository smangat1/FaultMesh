import React from 'react';
import type { RunSummary, GraphData } from '../types';
import { RunDiagnosticsPane } from './RunDiagnosticsPane';

interface RunsScreenProps {
  runs?: RunSummary[];
  activeRun: RunSummary | null;
  graphData: GraphData;
  onSelectRun?: (runId: string) => void;
  onNavigateToTests?: () => void;
  onNavigateToGraph?: () => void;
}

export const RunsScreen: React.FC<RunsScreenProps> = ({
  activeRun,
  graphData,
}) => {
  return <RunDiagnosticsPane activeRun={activeRun} graphData={graphData} />;
};
