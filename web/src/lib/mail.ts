import { env } from "./env";

/**
 * Outbound mail, with a transport that degrades honestly.
 *
 *   smtp     - a real server, for a public realm.
 *   console  - writes the message (and the reset link) to the server log.
 *              Perfect for a homelab realm with no mail server: the operator
 *              reads the link out of the console.
 *   disabled - refuses to send, so password reset can be turned off entirely.
 *
 * Nodemailer is imported lazily so a site running without SMTP never loads it.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export type MailResult = { sent: boolean; reason?: string };

export async function sendMail(mail: Mail): Promise<MailResult> {
  switch (env.mail.transport) {
    case "disabled":
      return { sent: false, reason: "mail transport is disabled" };

    case "console":
      console.info(
        [
          "",
          "──────── ashmorrow mail (MAIL_TRANSPORT=console) ────────",
          `to:      ${mail.to}`,
          `subject: ${mail.subject}`,
          "",
          mail.text,
          "─────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
      return { sent: true };

    case "smtp": {
      try {
        const nodemailer = (await import("nodemailer")).default;
        const transporter = nodemailer.createTransport({
          host: env.mail.smtp.host,
          port: env.mail.smtp.port,
          secure: env.mail.smtp.secure,
          auth: env.mail.smtp.user
            ? { user: env.mail.smtp.user, pass: env.mail.smtp.password }
            : undefined,
        });
        await transporter.sendMail({
          from: env.mail.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        });
        return { sent: true };
      } catch (error) {
        console.error("[mail] SMTP send failed:", error instanceof Error ? error.message : error);
        return { sent: false, reason: "smtp error" };
      }
    }
  }
}

export function passwordResetMail(username: string, link: string, minutes: number): Mail {
  return {
    to: "",
    subject: "Reset your Ashmorrow password",
    text: [
      `A password reset was requested for the Ashmorrow account ${username}.`,
      "",
      "Open this link to choose a new password:",
      link,
      "",
      `The link expires in ${minutes} minutes and works once.`,
      "If you did not ask for this, ignore this message - nothing has changed.",
      "",
      "— Tomorrow's Ash",
    ].join("\n"),
  };
}
