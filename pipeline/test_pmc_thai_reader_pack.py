import unittest

from pipeline.build_pmc_thai_reader_pack import (
    parse_article_xml,
    pdf_text_has_cc_by_notice,
    validate_cloud_metadata,
)


ARTICLE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="research-article" xml:lang="en">
  <front><journal-meta>
    <journal-title-group><journal-title>Journal of Useful Evidence</journal-title></journal-title-group>
    <publisher><publisher-name>Evidence Publisher</publisher-name></publisher>
  </journal-meta><article-meta>
    <article-id pub-id-type="pmcid">PMC123456</article-id>
    <article-id pub-id-type="doi">10.1234/example.1</article-id>
    <title-group><article-title>A Thai-affiliated study</article-title></title-group>
    <contrib-group>
      <contrib contrib-type="author"><name><surname>Researcher</surname><given-names>A.</given-names></name><xref ref-type="aff" rid="aff1"/></contrib>
    </contrib-group>
    <aff id="aff1">Faculty of Science, Example University, Bangkok, <country country="TH">Thailand</country></aff>
    <pub-date pub-type="epub"><day>12</day><month>7</month><year>2025</year></pub-date>
    <permissions><license license-type="open-access" xlink:href="https://creativecommons.org/licenses/by/4.0/">
      <license-p>This is an open access article distributed under the Creative Commons Attribution License.</license-p>
    </license></permissions>
  </article-meta></front>
  <body><sec><title>Introduction</title><p>Study content.</p></sec></body>
</article>"""


class PmcThaiReaderPackTest(unittest.TestCase):
    def test_pdf_text_must_repeat_a_cc_by_notice(self) -> None:
        self.assertTrue(pdf_text_has_cc_by_notice([
            "This article is distributed under the Creative Commons Attribution 4.0 International License."
        ]))
        self.assertTrue(pdf_text_has_cc_by_notice([
            "License: https://creativecommons.org/licenses/by/4.0/"
        ]))
        self.assertFalse(pdf_text_has_cc_by_notice(["Copyright 2025. All rights reserved."]))

    def test_cloud_metadata_accepts_only_current_cc_by_version_with_checksum_urls(self) -> None:
        metadata = {
            "pmcid": "PMC123456",
            "version": 1,
            "doi": "10.1234/example.1",
            "title": "A Thai-affiliated study",
            "is_pmc_openaccess": True,
            "is_manuscript": False,
            "is_historical_ocr": False,
            "is_retracted": False,
            "license_code": "CC BY",
            "pdf_url": "s3://pmc-oa-opendata/PMC123456.1/PMC123456.1.pdf?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "xml_url": "s3://pmc-oa-opendata/PMC123456.1/PMC123456.1.xml?md5=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }
        validated = validate_cloud_metadata(metadata, expected_pmcid="PMC123456")

        self.assertEqual(validated["versionId"], "PMC123456.1")
        self.assertEqual(
            validated["pdfUrl"],
            "https://pmc-oa-opendata.s3.amazonaws.com/PMC123456.1/PMC123456.1.pdf?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        )
        self.assertEqual(validated["pdfMd5"], "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        self.assertEqual(validated["xmlMd5"], "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

        for field, value in (("is_manuscript", True), ("is_retracted", True)):
            rejected = {**metadata, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_cloud_metadata(rejected, expected_pmcid="PMC123456")

    def test_jats_parser_requires_and_preserves_linked_thai_affiliation_and_item_license(self) -> None:
        article = parse_article_xml(ARTICLE_XML, expected_pmcid="PMC123456")

        self.assertEqual(article["title"], "A Thai-affiliated study")
        self.assertEqual(article["authors"], ["A. Researcher"])
        self.assertEqual(article["doi"], "10.1234/example.1")
        self.assertEqual(article["publishedAt"], "2025-07-12")
        self.assertEqual(article["journalTitle"], "Journal of Useful Evidence")
        self.assertEqual(article["publisher"], "Evidence Publisher")
        self.assertEqual(article["articleType"], "Research Article")
        self.assertEqual(article["affiliationCountries"], ["TH"])
        self.assertIn("Thailand", article["thaiAffiliationEvidence"][0])
        self.assertEqual(article["thaiAffiliationLinkage"], "author_xref")
        self.assertEqual(article["licenseExpression"], "CC-BY-4.0")
        self.assertEqual(article["licenseUrl"], "https://creativecommons.org/licenses/by/4.0/")

    def test_jats_parser_fails_closed_without_thai_affiliation(self) -> None:
        xml = ARTICLE_XML.replace(b"Thailand", b"Singapore").replace(b'country="TH"', b'country="SG"')
        with self.assertRaisesRegex(ValueError, "Thailand affiliation"):
            parse_article_xml(xml, expected_pmcid="PMC123456")

    def test_jats_parser_fails_closed_for_non_attribution_license(self) -> None:
        xml = ARTICLE_XML.replace(b"licenses/by/4.0", b"licenses/by-nc/4.0")
        with self.assertRaisesRegex(ValueError, "CC BY"):
            parse_article_xml(xml, expected_pmcid="PMC123456")

    def test_jats_parser_accepts_nlm_license_ref_used_by_current_pmc_exports(self) -> None:
        xml = ARTICLE_XML.replace(
            b'<license license-type="open-access" xlink:href="https://creativecommons.org/licenses/by/4.0/">',
            b'<license><ali:license_ref xmlns:ali="http://www.niso.org/schemas/ali/1.0/">https://creativecommons.org/licenses/by/4.0/</ali:license_ref>',
        )
        article = parse_article_xml(xml, expected_pmcid="PMC123456")
        self.assertEqual(article["licenseExpression"], "CC-BY-4.0")


if __name__ == "__main__":
    unittest.main()
