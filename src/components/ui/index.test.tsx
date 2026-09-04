import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, IconButton, Progress } from ".";

describe("shared UI accessibility contracts", () => {
  it("keeps ordinary buttons from submitting a surrounding form by accident", () => {
    render(<form><Button>Safe action</Button><Button type="submit">Submit</Button></form>);
    expect(screen.getByRole("button", { name: "Safe action" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "submit");
  });

  it("gives icon-only controls an accessible name", () => {
    render(<IconButton label="Open navigation"><span aria-hidden="true">+</span></IconButton>);
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveAttribute("title", "Open navigation");
  });

  it("exposes normalized progress values to assistive technology", () => {
    render(<Progress value={140}/>);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });
});
