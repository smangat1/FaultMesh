import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReplayDiffViewer } from '../components/replay/ReplayDiffViewer';
import type { ChangedFileView } from '../replay/types';

const reconstructedFile: ChangedFileView = {
  path: 'src/synthetic.py',
  change: 'modified',
  before_sha256: 'a'.repeat(64),
  after_sha256: 'b'.repeat(64),
  unified_diff: '--- src/synthetic.py\n+++ src/synthetic.py\n@@ -1 +1 @@\n-old\n+new\n',
  derived_from: 'recorded_patch',
  file_state: 'reconstructed_from_current_checkout_unverified',
  reconstruction_label: 'reconstructed from current checkout (unverified)',
  before_text: 'old\n',
  after_text: 'new\n',
};

describe('Phase 2 replay history file reconstruction UX', () => {
  it('labels reconstructed diffs as derived and unverified', () => {
    render(
      <ReplayDiffViewer
        selectedFile={reconstructedFile.path}
        changedFiles={[reconstructedFile]}
        changedSymbols={[]}
        onSelectFile={vi.fn()}
        getHistoricalContent={() => ({ content: null, sha256: null })}
      />
    );

    expect(screen.getByTestId('replay-derived-file-state').textContent).toBe(
      'Derived: reconstructed from current checkout (unverified)'
    );
  });

  it('keeps failed reconstruction explicitly unknown', () => {
    render(
      <ReplayDiffViewer
        selectedFile={reconstructedFile.path}
        changedFiles={[
          {
            ...reconstructedFile,
            file_state: 'unknown',
            reconstruction_label: null,
            before_text: null,
            after_text: null,
          },
        ]}
        changedSymbols={[]}
        onSelectFile={vi.fn()}
        getHistoricalContent={() => ({ content: null, sha256: null })}
      />
    );

    expect(screen.getByTestId('replay-unknown-file-state').textContent).toContain(
      'Derived file state: unknown'
    );
  });
});
