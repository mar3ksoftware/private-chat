import Linkify from 'linkify-react';

type LinkifiedTextProps = {
  readonly text: string;
  readonly className?: string | undefined;
};

export function LinkifiedText({ text, className }: LinkifiedTextProps) {
  return (
    <Linkify
      options={{
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'text-indigo-400 hover:text-indigo-300 underline',
      }}
    >
      <span className={className}>{text}</span>
    </Linkify>
  );
}
