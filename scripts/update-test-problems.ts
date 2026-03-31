import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

// Preserve original LaTeX exactly, only inject interactive tags
const problem1_1 = `Problem 1.1: (1.3 #4. Introduction to Linear Algebra: Strang) Find a combination $ x_{1} \\mathbf{w}_{1} + x_{2} \\mathbf{w}_{2} + x_{3} \\mathbf{w}_{3} $ that gives the zero vector:
$$
\\mathbf{w}_{1} = \\left[ \\begin{array}{lll} 1 \\\\[6pt] 2 \\\\[6pt] 3 \\end{array} \\right] \\quad \\mathbf{w}_{2} = \\left[ \\begin{array}{lll} 4 \\\\[6pt] 5 \\\\[6pt] 6 \\end{array} \\right] \\quad \\mathbf{w}_{3} = \\left[ \\begin{array}{lll} 7 \\\\[6pt] 8 \\\\[6pt] 9 \\end{array} \\right].
$$

$x_1$ = <FillInBlank answer="1" />, $x_2$ = <FillInBlank answer="-2" />, $x_3$ = <FillInBlank answer="1" />

Those vectors are:

<MultipleChoice options={["Dependent","Independent"]} answer="Dependent" />

The three vectors lie in a <FillInBlank answer="plane" />. The matrix $ W $ with those columns is not invertible.`;

const problem1_2 = `Problem 1.2: Multiply:

$$
\\left[ \\begin{array}{lll} 1 & 2 & 0 \\\\[6pt] 2 & 0 & 3 \\\\[6pt] 4 & 1 & 1 \\end{array} \\right] \\left[ \\begin{array}{l} 3 \\\\[6pt] -2 \\\\[6pt] 1 \\end{array} \\right]
$$

<FreeResponse prompt="Compute the product." answer="$\\left[ \\begin{array}{lll} -1 \\\\[6pt] 9 \\\\[6pt] 11 \\end{array} \\right]$" />`;

const problem1_3 = `Problem 1.3: True or false: A 3 by 2 matrix $ A $ times a 2 by 3 matrix $ B $ equals a 3 by 3 matrix $ AB $. If this is false, write a similar sentence which is correct.

<MultipleChoice options={["True","False"]} answer="True" />`;

async function main() {
  const updates = [
    { id: 1863, question_text: problem1_1 },
    { id: 1864, question_text: problem1_2 },
    { id: 1865, question_text: problem1_3 },
  ];

  for (const u of updates) {
    const { error } = await supabase
      .from("problems")
      .update({ question_text: u.question_text })
      .eq("id", u.id);

    if (error) {
      console.error("Error updating problem", u.id, error);
    } else {
      console.log("Updated problem", u.id);
    }
  }

  // Verify
  const { data } = await supabase
    .from("problems")
    .select("id, question_text")
    .in("id", [1863, 1864, 1865]);

  data?.forEach((p) => {
    console.log("\n=== ID:", p.id, "===");
    console.log(p.question_text);
  });
}

main();
