from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from bs4 import BeautifulSoup
from common import clean_description, infer_topics, update_source_health
from update_reader_fallback import extract_markdown, extract_sitemap_urls
from update_reports import extract_published_at, parse_robots_text

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

    def test_reader_accepts_relative_official_links(self):
        text = """
[Frontiers of compute: The technologies to reduce AI inference costs](./frontiers-of-compute-the-technologies-to-reduce-ai-inference-costs)
June 25, 2026 - AI’s next breakthrough may not be a smarter model but a cheaper token.
[The next era of semiconductor value creation](/industries/semiconductors/our-insights/the-next-era-of-semiconductor-value-creation)
March 30, 2026 - Semiconductor companies must make bold strategic moves.
"""
        source = {"company":"McKinsey","name":"McKinsey Semiconductor Insights Reader","url":"https://www.mckinsey.com/industries/semiconductors/our-insights","allowed_path_prefixes":["/industries/semiconductors/our-insights/"]}
        topics = {"AI":["AI"],"Semiconductor":["semiconductor"]}
        rows = extract_markdown(text, source, topics, "2026-08-16T00:00:00Z")
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["url"].startswith("https://www.mckinsey.com/industries/semiconductors/our-insights/") for r in rows))

    def test_sitemap_heartbeat_filters_to_curated_namespaces(self):
        text = """
[https://www.mckinsey.com/industries/semiconductors/our-insights/a](https://www.mckinsey.com/industries/semiconductors/our-insights/a)
[https://www.mckinsey.com/industries/industrials/our-insights/b](https://www.mckinsey.com/industries/industrials/our-insights/b)
[https://www.mckinsey.com/careers/jobs/c](https://www.mckinsey.com/careers/jobs/c)
[https://example.com/industries/semiconductors/our-insights/d](https://example.com/industries/semiconductors/our-insights/d)
"""
        source = {"company":"McKinsey","name":"McKinsey Official Sitemap","url":"https://www.mckinsey.com/sitemap.xml","allowed_path_prefixes":["/industries/semiconductors/our-insights/","/industries/industrials/our-insights/"]}
        urls = extract_sitemap_urls(text, source)
        self.assertEqual(urls, {
            "https://www.mckinsey.com/industries/semiconductors/our-insights/a",
            "https://www.mckinsey.com/industries/industrials/our-insights/b",
        })

    def test_reader_wrapped_robots_text_stays_fail_closed_and_respects_rules(self):
        text = """Title: robots.txt\nURL Source: https://www.mckinsey.com/robots.txt\nMarkdown Content:\nUser-agent: *\nDisallow: /search/\nDisallow: /userprofile/\nSitemap: https://www.mckinsey.com/sitemap.xml\n"""
        parser = parse_robots_text("https://www.mckinsey.com/robots.txt", text)
        self.assertIsNotNone(parser)
        assert parser is not None
        self.assertTrue(parser.can_fetch("ConsultantSystemBot", "https://www.mckinsey.com/industries/semiconductors/our-insights"))
        self.assertFalse(parser.can_fetch("ConsultantSystemBot", "https://www.mckinsey.com/search/foo"))
        self.assertIsNone(parse_robots_text("https://example.com/robots.txt", "Title: no rules here"))

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
