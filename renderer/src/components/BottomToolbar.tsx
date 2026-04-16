import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { vscode } from '../electronApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  isMonitorOpen?: boolean;
  onToggleMonitor?: () => void;
  isHelpOpen?: boolean;
  onToggleHelp?: () => void;
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  isMonitorOpen,
  onToggleMonitor,
  isHelpOpen,
  onToggleHelp,
}: BottomToolbarProps) {
  const { t } = useTranslation();
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  const pendingResumeRef = useRef<'resume' | 'continue' | null>(null);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    pendingResumeRef.current = null;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    const resumeMode = pendingResumeRef.current;
    pendingBypassRef.current = false;
    pendingResumeRef.current = null;
    vscode.postMessage({
      type: 'openClaude',
      folderPath: folder.path,
      bypassPermissions,
      ...(resumeMode === 'resume' ? { resume: true } : {}),
      ...(resumeMode === 'continue' ? { continueSession: true } : {}),
    });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      vscode.postMessage({ type: 'openClaude', bypassPermissions });
    }
  };

  const handleResumeSelect = () => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      setIsFolderPickerOpen(true);
      pendingResumeRef.current = 'resume';
    } else {
      vscode.postMessage({ type: 'openClaude', resume: true, bypassPermissions: pendingBypassRef.current });
    }
  };

  const handleContinueSelect = () => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      setIsFolderPickerOpen(true);
      pendingResumeRef.current = 'continue';
    } else {
      vscode.postMessage({ type: 'openClaude', continueSession: true, bypassPermissions: pendingBypassRef.current });
    }
  };

  return (
    <div className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <div
        ref={folderPickerRef}
        className="relative"
        onMouseEnter={handleAgentHover}
        onMouseLeave={handleAgentLeave}
      >
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isBypassMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          {t('toolbar.addAgent')}
        </Button>
        <Dropdown isOpen={isBypassMenuOpen}>
          <DropdownItem onClick={() => handleBypassSelect(true)}>
            {t('toolbar.dropdown.skipPermissions')} <span className="text-2xs text-warning">⚠</span>
          </DropdownItem>
          <DropdownItem onClick={handleResumeSelect}>
            {t('toolbar.dropdown.resumeSession')}
          </DropdownItem>
          <DropdownItem onClick={handleContinueSelect}>
            {t('toolbar.dropdown.continueSession')}
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title={t('toolbar.layout')}
      >
        {t('toolbar.layout')}
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title={t('toolbar.settings')}
      >
        {t('toolbar.settings')}
      </Button>
      {onToggleMonitor && (
        <Button
          variant={isMonitorOpen ? 'active' : 'default'}
          onClick={onToggleMonitor}
          title={t('toolbar.monitor')}
        >
          {t('toolbar.monitor')}
        </Button>
      )}
      {onToggleHelp && (
        <Button
          variant={isHelpOpen ? 'active' : 'default'}
          onClick={onToggleHelp}
          title={t('help.title')}
        >
          {t('toolbar.help')}
        </Button>
      )}
    </div>
  );
}
