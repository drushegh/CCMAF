/**
 * DocsPage.tsx — Generic docs browser (TASK-028)
 *
 * Two panes: a tree of the project's docs/ folder (left) and a content pane
 * (right). No assumed structure — markdown renders, images show inline, other
 * allowlisted files offer a raw link. Degrades to an empty state when docs/ is
 * absent. All file access is confined to docs/ server-side (docs-fs.ts).
 */

import { useCallback, useMemo, useState } from "react";
import {
  FolderOpen,
  Folder,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import {
  fetchDocsTree,
  fetchDocText,
  docRawUrl,
  firstFile,
  isImageExt,
  isMarkdownExt,
  isTextExt,
} from "../api/docs";
import type { DocsNode } from "../api/docs";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

function fileIcon(ext?: string) {
  if (isImageExt(ext)) return <ImageIcon size={14} />;
  if (isTextExt(ext)) return <FileText size={14} />;
  return <FileIcon size={14} />;
}

// ── Tree ────────────────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: DocsNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (n: DocsNode) => void;
}) {
  const [open, setOpen] = useState(true);

  if (node.type === "dir") {
    return (
      <li className="docs-tree-item">
        <button
          type="button"
          className="docs-tree-row docs-tree-row--dir"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="docs-tree-caret">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          {open ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span className="docs-tree-name">{node.name}</span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <ul className="docs-tree-list" role="group">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const active = node.path === selectedPath;
  return (
    <li className="docs-tree-item">
      <button
        type="button"
        className={`docs-tree-row docs-tree-row--file ${active ? "is-active" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14 + 14}px` }}
        onClick={() => onSelect(node)}
        aria-current={active ? "true" : undefined}
      >
        {fileIcon(node.ext)}
        <span className="docs-tree-name">{node.name}</span>
      </button>
    </li>
  );
}

// ── Content pane ──────────────────────────────────────────────────────────────

function DocViewer({ file }: { file: DocsNode }) {
  const isText = isTextExt(file.ext);
  // Markdown/text are fetched as a string and rendered client-side; images load
  // directly via <img src>. Re-fetch when the selected path changes.
  const textState = useAsync(
    () => (isText ? fetchDocText(file.path) : Promise.resolve("")),
    [file.path, isText]
  );

  // Rewrite a doc's relative <img src> to the raw endpoint (resolved against the
  // doc's own directory). Absolute / data URLs pass through. The server collapses
  // any ../ and rejects escapes, so this is safe even for odd relative paths.
  const transformImgSrc = useCallback(
    (src: string) => {
      if (/^(https?:|data:|\/)/i.test(src)) return src;
      const dir = file.path.includes("/")
        ? file.path.slice(0, file.path.lastIndexOf("/"))
        : "";
      return docRawUrl(dir ? `${dir}/${src}` : src);
    },
    [file.path]
  );

  if (isImageExt(file.ext)) {
    return (
      <div className="docs-viewer docs-viewer--image">
        <img className="docs-image" src={docRawUrl(file.path)} alt={file.name} />
        <div className="docs-viewer-caption">{file.path}</div>
      </div>
    );
  }

  if (!isText) {
    return (
      <div className="docs-viewer">
        <EmptyState
          icon={<FileIcon size={22} />}
          title="No inline preview"
          description={`"${file.name}" isn't a markdown or image file.`}
          action={
            <a
              className="section-link"
              href={docRawUrl(file.path)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open raw →
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="docs-viewer">
      {textState.phase === "loading" && <LoadingState label={`Loading ${file.name}…`} />}
      {textState.phase === "error" && (
        <ErrorState error={textState.error} onRetry={textState.reload} />
      )}
      {textState.phase === "ready" &&
        (isMarkdownExt(file.ext) ? (
          <div className="readme-doc">
            <Markdown source={textState.data} transformImgSrc={transformImgSrc} />
          </div>
        ) : (
          <pre className="docs-pre">{textState.data}</pre>
        ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DocsPage() {
  const { phase, data, error, reload } = useAsync(fetchDocsTree, []);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // Default selection: the first file in the tree (once loaded).
  const initialFile = useMemo(
    () => (phase === "ready" ? firstFile(data.root) : null),
    [phase, data]
  );
  const effectivePath = selectedPath ?? initialFile?.path ?? null;

  // Resolve the selected node from the tree by path.
  const selected = useMemo(() => {
    if (phase !== "ready" || !effectivePath) return null;
    const find = (n: DocsNode | null): DocsNode | null => {
      if (!n) return null;
      if (n.type === "file" && n.path === effectivePath) return n;
      for (const c of n.children ?? []) {
        const f = find(c);
        if (f) return f;
      }
      return null;
    };
    return find(data.root);
  }, [phase, data, effectivePath]);

  return (
    <PageLayout title="Docs" subtitle="Browse the project docs/ folder" badge="docs/">
      {phase === "loading" && <LoadingState label="Loading docs…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (!data.exists ||
        !data.root ||
        (data.root.children?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<FolderOpen size={22} />}
            title="No docs/ folder yet"
            description="Create a docs/ folder at the project root and drop markdown, images (e.g. an inspiration/ subfolder), or research notes in it — they'll appear here to click through. No fixed structure required."
          />
        ) : (
          <div className="docs-split">
            <nav className="docs-tree" aria-label="Docs tree">
              <ul className="docs-tree-list docs-tree-list--root" role="tree">
                {data.root.children!.map((child) => (
                  <TreeNode
                    key={child.path}
                    node={child}
                    depth={0}
                    selectedPath={effectivePath}
                    onSelect={(n) => setSelectedPath(n.path)}
                  />
                ))}
              </ul>
            </nav>
            <div className="docs-content">
              {selected ? (
                <DocViewer file={selected} />
              ) : (
                <p className="docs-pick">Select a file to view it.</p>
              )}
            </div>
          </div>
        ))}
    </PageLayout>
  );
}
