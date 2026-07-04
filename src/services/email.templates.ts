export function wrapTemplate(title: string, bodyHtml: string): string {
    return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2933;">
      <h2 style="color: #0f766e;">${title}</h2>
      ${bodyHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">HomeLink &mdash; Property Rental Management</p>
    </div>`;
}

export function verificationEmailTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Verify your email",
        `<p>Hi ${firstName},</p><p>Welcome to HomeLink. Please verify your email by clicking the link below:</p>
         <p><a href="${link}">${link}</a></p>`
    );
}

export function passwordResetTemplate(firstName: string, link: string): string {
    return wrapTemplate(
        "Reset your password",
        `<p>Hi ${firstName},</p><p>We received a request to reset your password. This link expires in 1 hour:</p>
         <p><a href="${link}">${link}</a></p><p>If you did not request this, you can ignore this email.</p>`
    );
}

export function rentReminderTemplate(firstName: string, amount: string, dueDate: string): string {
    return wrapTemplate(
        "Rent payment reminder",
        `<p>Hi ${firstName},</p><p>This is a reminder that a rent payment of <strong>${amount}</strong> is due on <strong>${dueDate}</strong>.</p>`
    );
}

export function genericNotificationTemplate(firstName: string, message: string): string {
    return wrapTemplate("HomeLink Notification", `<p>Hi ${firstName},</p><p>${message}</p>`);
}
