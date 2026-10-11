import { useEffect, useState } from "react";
import { checkLesson, lessonFor } from "../lib/recipes/check";
import { listRecipes, recipeIdOf } from "../lib/recipes/catalog";
import { useStudio } from "../studio/store";
import { text } from "./text";

/**
 * Recipes and the one-step challenge.
 *
 * A recipe is a new project. The check reads the open project's main.py and the
 * console. Asking for a version builds a candidate; adopt is what writes.
 */
export function RecipesDialog() {
  const studio = useStudio();
  const recipes = listRecipes();
  const openId = studio.project ? recipeIdOf(studio.project.files) : null;
  if (!studio.recipesOpen) return null;
  return (
    <div className="modal-back">
      <section className="modal recipes" role="dialog" aria-labelledby="recipes-title" data-testid="recipes-dialog">
        <header>
          <h2 id="recipes-title">{text.recipes.title}</h2>
          <p>{text.recipes.copy}</p>
          <p>{text.recipes.paths}</p>
        </header>
        <div className="recipe-paths">
          <button type="button" className="ghost" onClick={() => { studio.setView("code"); studio.setRecipesOpen(false); }}>
            {text.recipes.write}
          </button>
          <button type="button" className="ghost" onClick={() => { studio.setView("design"); studio.setRecipesOpen(false); }}>
            {text.recipes.ask}
          </button>
        </div>
        <ul className="recipe-list">
          {recipes.map((recipe) => (
            <li key={recipe.id} data-testid={`recipe-${recipe.id}`}>
              <h3>{recipe.title}</h3>
              <p>{recipe.summary}</p>
              <p className="quiet">
                {text.recipes.knowledge}：{recipe.knowledge.join("；")}
              </p>
              <p className="quiet">{recipe.goal}</p>
              <div className="modal-actions">
                <button type="button" className="run" data-testid={`recipe-new-${recipe.id}`} onClick={() => studio.newRecipe(recipe.id)}>
                  {text.recipes.example}
                </button>
                {openId === recipe.id ? (
                  <button
                    type="button"
                    className="ghost"
                    data-testid={`recipe-resume-${recipe.id}`}
                    onClick={() => {
                      studio.setRecipesOpen(false);
                      studio.setChallengeOpen(true);
                    }}
                  >
                    {text.recipes.resume}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="ghost"
                    data-testid={`recipe-challenge-${recipe.id}`}
                    onClick={() => studio.newRecipe(recipe.id, true)}
                  >
                    {text.recipes.challenge}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => studio.setRecipesOpen(false)}>
            {text.recipes.close}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ChallengeDialog() {
  const studio = useStudio();
  const recipeId = studio.project ? recipeIdOf(studio.project.files) : null;
  const lessonId = recipeId;
  const [showHint, setShowHint] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; say: string; evidence: string } | null>(null);

  useEffect(() => {
    setShowHint(false);
    setShowExplain(false);
    setResult(null);
  }, [studio.project?.id, lessonId]);

  if (!studio.challengeOpen) return null;
  const info = listRecipes().find((recipe) => recipe.id === lessonId);
  const lesson = lessonId ? lessonFor(lessonId) : null;
  const source = studio.project?.files.find((file) => file.path === "main.py")?.text ?? "";
  return (
    <div className="modal-back">
      <section className="modal challenge" role="dialog" aria-labelledby="challenge-title" data-testid="challenge-dialog">
        <header>
          <h2 id="challenge-title">{text.recipes.challengeTitle}</h2>
          <p>{info ? info.title : text.recipes.notRecipe}</p>
        </header>
        {info && lessonId ? (
          <>
            <p data-testid="challenge-goal">{info.goal}</p>
            <div className="modal-actions">
              <button type="button" className="ghost" data-testid="challenge-hint" onClick={() => setShowHint(true)}>
                {text.recipes.hint}
              </button>
              <button type="button" className="ghost" data-testid="challenge-explain" onClick={() => setShowExplain(true)}>
                {text.recipes.explain}
              </button>
              <button
                type="button"
                className="ghost"
                data-testid="challenge-check"
                onClick={() => {
                  const verdict = checkLesson(lessonId, source, studio.consoleText);
                  if (verdict) setResult(verdict);
                }}
              >
                {text.recipes.check}
              </button>
              <button type="button" className="run" data-testid="challenge-candidate" onClick={() => studio.offerLessonCandidate(lessonId)}>
                {text.recipes.candidate}
              </button>
            </div>
            {showHint && lesson ? <p data-testid="challenge-hint-text">{lesson.hint}</p> : null}
            {showExplain && lesson ? <p data-testid="challenge-explain-text">{lesson.explain}</p> : null}
            {result ? (
              <div data-testid="challenge-result" data-ok={result.ok ? "true" : "false"}>
                <p>{result.say}</p>
                <details>
                  <summary>{text.recipes.evidence}</summary>
                  <pre className="library-snippet">{result.evidence}</pre>
                </details>
              </div>
            ) : null}
          </>
        ) : (
          <button type="button" className="run" onClick={() => { studio.setChallengeOpen(false); studio.setRecipesOpen(true); }}>
            {text.recipes.open}
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => studio.setChallengeOpen(false)}>
            {text.recipes.close}
          </button>
        </div>
      </section>
    </div>
  );
}
