import type { AskUserQuestion } from '@worldbookllm/shared';
import { useState } from 'react';

import { clearDraft, useStoredDraft } from '../drafts.js';
import {
  composeAnswer,
  emptyAnswers,
  isAnswered,
  type PendingQuestion,
  type QuestionAnswer,
} from './agent-turns.js';

interface AgentQuestionProps {
  chatId: string;
  question: PendingQuestion;
  /** True while a turn runs or the chat is busy elsewhere. */
  disabled: boolean;
  /** Sends the answer as the writer's next message. */
  onAnswer: (content: string, callId: string) => Promise<'accepted' | 'rejected'>;
}

/**
 * The agent's `ask_user` questions as choices (ADR 0022): one button per
 * option, and a last "Other" choice for an answer in the writer's own words.
 * A single question with a single choice sends as soon as an option is
 * picked; anything else sends with "Send answer".
 */
export function AgentQuestion({ chatId, question, disabled, onAnswer }: AgentQuestionProps) {
  const { callId, questions } = question;
  const fallback = emptyAnswers(questions);
  const draftKey = `agent-question:${chatId}:${callId}`;
  const [answers, setAnswers] = useStoredDraft<QuestionAnswer[]>(draftKey, fallback);
  const [sending, setSending] = useState(false);
  const quick = questions.length === 1 && questions[0]?.multiSelect !== true;
  const complete = questions.every((_, index) => isAnswered(answers[index]));
  const locked = disabled || sending;

  async function send(next: QuestionAnswer[]) {
    if (locked) return;
    setSending(true);
    const outcome = await onAnswer(composeAnswer(questions, next), callId);
    if (outcome === 'accepted') {
      // The card unmounts once the turn starts, so clear the stored draft directly.
      clearDraft(draftKey);
      setAnswers(fallback);
    }
    setSending(false);
  }

  function update(index: number, change: (answer: QuestionAnswer) => QuestionAnswer) {
    const next = questions.map((_, at) => {
      const current = answers[at] ?? { selected: [], other: false, text: '' };
      return at === index ? change(current) : current;
    });
    setAnswers(next);
    return next;
  }

  function pick(index: number, item: AskUserQuestion, label: string) {
    if (item.multiSelect === true) {
      update(index, (answer) => ({
        ...answer,
        selected: answer.selected.includes(label)
          ? answer.selected.filter((value) => value !== label)
          : [...answer.selected, label],
      }));
      return;
    }
    const next = update(index, () => ({ selected: [label], other: false, text: '' }));
    if (quick) void send(next);
  }

  function chooseOther(index: number, item: AskUserQuestion) {
    update(index, (answer) =>
      item.multiSelect === true
        ? { ...answer, other: !answer.other }
        : { selected: [], other: true, text: answer.text },
    );
    requestAnimationFrame(() =>
      document.getElementById(`agent-question-${callId}-${index}-other`)?.focus(),
    );
  }

  return (
    <section className="agent-question" aria-label="The agent asks">
      {questions.map((item, index) => {
        const answer = answers[index] ?? { selected: [], other: false, text: '' };
        const otherId = `agent-question-${callId}-${index}-other`;
        return (
          <fieldset key={index} className="agent-question-item" disabled={locked}>
            <legend>
              {item.header === undefined ? null : (
                <span className="coordinate-label">{item.header}</span>
              )}
              <span className="agent-question-text">{item.question}</span>
            </legend>
            {item.multiSelect === true ? (
              <p className="agent-question-hint">Choose any that fit.</p>
            ) : null}
            <div className="agent-question-options">
              {item.options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  className="agent-question-option"
                  aria-pressed={answer.selected.includes(option.label)}
                  onClick={() => pick(index, item, option.label)}
                >
                  <strong>{option.label}</strong>
                  {option.description === undefined ? null : <small>{option.description}</small>}
                </button>
              ))}
              <button
                type="button"
                className="agent-question-option"
                aria-pressed={answer.other}
                aria-controls={otherId}
                onClick={() => chooseOther(index, item)}
              >
                <strong>Other…</strong>
                <small>Answer in your own words.</small>
              </button>
            </div>
            {answer.other ? (
              <textarea
                id={otherId}
                aria-label={`Your answer: ${item.question}`}
                rows={2}
                value={answer.text}
                onChange={(event) =>
                  update(index, (current) => ({ ...current, text: event.target.value }))
                }
              />
            ) : null}
          </fieldset>
        );
      })}
      {quick && !(answers[0]?.other ?? false) ? null : (
        <div className="agent-question-actions">
          <button
            type="button"
            className="button-primary"
            disabled={locked || !complete}
            onClick={() => void send(answers)}
          >
            {sending ? 'Sending…' : 'Send answer'}
          </button>
        </div>
      )}
    </section>
  );
}
