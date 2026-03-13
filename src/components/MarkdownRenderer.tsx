import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // Pre-process content to highlight text inside 『』 brackets
  const processedContent = content.replace(/『(.*?)』/g, (match, p1) => {
    return `<span class="highlight-text font-bold text-emerald-700 bg-emerald-50 px-1 rounded mx-0.5">『${p1}』</span>`;
  });

  return (
    <div className="prose prose-slate max-w-none prose-sm overflow-hidden">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-4 rounded-lg border border-slate-200 shadow-sm">
              <table className="min-w-full divide-y divide-slate-200" {...props} />
            </div>
          ),
          // ... other components remain the same
          thead: ({ node, ...props }) => <thead className="bg-slate-50" {...props} />,
          th: ({ node, ...props }) => <th className="px-4 py-2 text-left text-xs font-bold text-slate-700 uppercase border-b" {...props} />,
          td: ({ node, ...props }) => <td className="px-4 py-2 text-sm text-slate-600 border-b border-slate-100" {...props} />,
          strong: ({ node, ...props }) => <strong className="font-bold text-slate-900" {...props} />,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
