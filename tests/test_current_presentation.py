from pathlib import Path
import app as game


def test_active_copy_matches_long_term_care_setting():
    root = Path(__file__).resolve().parents[1]
    files = [root / 'web/index.html', root / 'story.json', root / 'app.py', *list((root / 'web/src').glob('*.ts'))]
    for path in files:
        text = path.read_text(encoding='utf-8')
        assert '观止大厦' not in text, path
        assert '所有出口均已为您准备好' not in text, path
        assert '欢迎来到' not in text, path
    assert '临时的' not in game.STORY['stages'][0]['facts']
    assert '长期' in game.SYSTEM
