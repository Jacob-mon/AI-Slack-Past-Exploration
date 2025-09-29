import React from 'react';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // A simple parser for a subset of Markdown to avoid external dependencies.
  const renderMarkdown = () => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inList = false;
    let listItems: string[] = [];

    const endList = () => {
      if (inList) {
        elements.push(
          <ul key={`ul-${elements.length}`} className="list-disc list-inside space-y-2 my-4 pl-4">
            {listItems.map((item, index) => (
              <li key={index} dangerouslySetInnerHTML={{ __html: parseInline(item) }}></li>
            ))}
          </ul>
        );
        listItems = [];
        inList = false;
      }
    };

    const parseInline = (text: string) => {
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-indigo-400 hover:underline">$1</a>');
    };
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (line.startsWith('# ')) {
            endList();
            elements.push(<h1 key={i} className="text-2xl font-bold mt-6 mb-3 border-b border-gray-600 pb-2" dangerouslySetInnerHTML={{ __html: parseInline(line.substring(2)) }} />);
        } else if (line.startsWith('## ')) {
            endList();
            elements.push(<h2 key={i} className="text-xl font-semibold mt-5 mb-2" dangerouslySetInnerHTML={{ __html: parseInline(line.substring(3)) }} />);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            if (!inList) {
                inList = true;
            }
            listItems.push(line.substring(2));
        } else if (line.trim() === '') {
            endList();
            // Render a blank line as a paragraph break. Margins will handle spacing.
            if (i > 0 && lines[i - 1].trim() !== '') {
                elements.push(<div key={`br-${i}`} className="h-4"></div>);
            }
        } else {
            endList();
            elements.push(<p key={i} className="my-2 leading-relaxed" dangerouslySetInnerHTML={{ __html: parseInline(line) }} />);
        }
    }
    endList(); // Render any list at the end of the content

    return elements;
  };

  return <div className="font-sans text-sm text-gray-200">{renderMarkdown()}</div>;
};

export default MarkdownRenderer;
