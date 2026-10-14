import ReactMarkdown from 'react-markdown';
import LogoMark from './LogoMark';

export default function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-secondary rounded-2xl px-4 py-3 max-w-[85%] whitespace-pre-wrap text-[15px] leading-7">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <LogoMark className="w-5 h-5 mt-1.5 shrink-0" />
      <div className="quant-md font-heading min-w-0 flex-1 text-foreground/95">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}