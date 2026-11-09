'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

/**
 * Sanitised Markdown (NFR-10): react-markdown + remark-gfm + rehype-sanitize (default schema),
 * every element mapped to an MUI component. Raw HTML is never rendered.
 */
const components: Components = {
  h1: ({ children }) => <Typography variant="h5" component="h2" gutterBottom>{children}</Typography>,
  h2: ({ children }) => <Typography variant="h6" component="h3" gutterBottom>{children}</Typography>,
  h3: ({ children }) => <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }} gutterBottom>{children}</Typography>,
  h4: ({ children }) => <Typography variant="subtitle2" component="h5" gutterBottom>{children}</Typography>,
  h5: ({ children }) => <Typography variant="subtitle2" component="h6" gutterBottom>{children}</Typography>,
  h6: ({ children }) => <Typography variant="subtitle2" component="h6" gutterBottom>{children}</Typography>,
  p: ({ children }) => <Typography variant="body1" sx={{ mb: 1.5 }}>{children}</Typography>,
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
  ul: ({ children }) => <Box component="ul" sx={{ pl: 3, mb: 1.5 }}>{children}</Box>,
  ol: ({ children }) => <Box component="ol" sx={{ pl: 3, mb: 1.5 }}>{children}</Box>,
  li: ({ children }) => <Typography component="li" variant="body1">{children}</Typography>,
  blockquote: ({ children }) => (
    <Box component="blockquote" sx={{ borderLeft: 4, borderColor: 'divider', pl: 2, ml: 0, color: 'text.secondary' }}>
      {children}
    </Box>
  ),
  pre: ({ children }) => (
    <Box component="pre" sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontSize: 14 }}>
      {children}
    </Box>
  ),
  code: ({ children }) => <Box component="code" sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>{children}</Box>,
  hr: () => <Divider sx={{ my: 2 }} />,
  img: ({ src, alt }) => <Box component="img" src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} sx={{ maxWidth: '100%' }} />,
  table: ({ children }) => <Table size="small" sx={{ mb: 2 }}>{children}</Table>,
  thead: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableCell sx={{ fontWeight: 600 }}>{children}</TableCell>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
};

export function MarkdownView({ source }: { source: string | null | undefined }) {
  if (!source?.trim()) return null;
  return (
    <Box sx={{ wordBreak: 'break-word' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
        {source}
      </ReactMarkdown>
    </Box>
  );
}
