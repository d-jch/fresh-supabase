export interface LogoutButtonProps {
  action: string;
}

export function LogoutButton({ action }: LogoutButtonProps) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="intent" value="sign-out" />
      <button class="btn btn-outline" type="submit">Logout</button>
    </form>
  );
}
