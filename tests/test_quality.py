from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from bs4 import BeautifulSoup
from common import clean_description, infer_topics, update_source_health
from update_reader_fallback import extract_markdown
from update_reports import extract_published_at

class QualityTests(unittest.TestCase):
    def test_reader_card_does_not_borrow_next_card_topic(self):
        text = """
[What CEOs Should Know About China’s Business Ambitions](https://www.bcg.com/publications/2026/china-plan)
International Business Article August 13, 2026
The 15th Five-Year Plan reveals the country’s economic goals and constraints.
Learn More
![Image 56](https://assets.example.com/a.gif)
[Who Will Win as AI Rewrites Competitive Advantage?](https://www.bcg.com/publications/2026/ai-win)
Artificial Intelligence Article August 13, 2026
AI is shifting profit pools.
"""
        source = {"company":"BCG","name":"BCG Publications","url":"https://www.bcg.com/publications","allowed_path_prefixes":["/publications/"]}
        topics = {"AI":["AI"],"Economics":["economic"],"Strategy":["strategy"]}
        rows = extract_markdown(text, source, topics, "2026-08-16T00:00:00Z")
        china = next(r for r in rows if r["url"].endswith("china-plan"))
        self.assertNotIn("AI", china["topics"])
        self.assertNotIn("ai-win", china["description"])

    def test_dirty_asset_description_is_rejected(self):
        dirty = "url=http%3A%2F%2Fboston-consulting-group-brightspot.s3.amazonaws.com%2Ffoo.gif Image 52 Learn More"
        self.assertEqual(clean_description(dirty), "")

    def test_short_ai_keyword_uses_word_boundary(self):
        topics = {"AI":["AI"]}
        self.assertEqual(infer_topics("retail supply chain", topics), [])
        self.assertEqual(infer_topics("AI adoption", topics), ["AI"])

    def test_structured_date_precedes_visible_date(self):
        soup = BeautifulSoup("""<html><head><meta property='article:published_time' content='2026-08-14T09:00:00Z'></head><body><h1>Title</h1><div>August 13, 2026</div><time datetime='2026-08-15'>Updated</time></body></html>""", "html.parser")
        value, source = extract_published_at(soup)
        self.assertEqual(value, "2026-08-15")
        self.assertEqual(source, "time")

    def test_health_degrades_then_fails_after_threshold(self):
        payload = {"sources": {}}
        args = dict(company="McKinsey", name="Featured", url="https://www.mckinsey.com/featured-insights/en", transport="reader", transport_ok=True, observed_count=0, max_consecutive_empty_runs=3)
        one = update_source_health(payload, attempted_at="2026-08-16T01:00:00Z", **args)
        two = update_source_health(payload, attempted_at="2026-08-17T01:00:00Z", **args)
        three = update_source_health(payload, attempted_at="2026-08-18T01:00:00Z", **args)
        self.assertEqual(one["status"], "degraded")
        self.assertEqual(two["status"], "degraded")
        self.assertEqual(three["status"], "fail")

if __name__ == "__main__": unittest.main()
